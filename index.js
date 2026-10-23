require('dotenv').config();
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    EmbedBuilder, ChannelType, PermissionFlagsBits, Events, AttachmentBuilder, 
    MessageFlags, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, UserSelectMenuBuilder
} = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once(Events.ClientReady, async () => {
    console.log("Loggad in som " + client.user.tag + "!");
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (guild) {
        try {
            await guild.commands.set([
                { name: 'setup-ticket', description: 'Skapar panelen för support-tickets.' },
                { name: 'ticket-stats', description: 'Visar statistik över stängda ärenden.' }
            ]);
            console.log('Slash-kommandon registrerade.');
        } catch (error) { console.error(error); }
    }
    setInterval(checkInactiveTickets, 3600000);
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'ticket-stats') {
        await interaction.deferReply();
        const logChannel = client.channels.cache.get(process.env.LOG_CHANNEL_ID);
        if (!logChannel) return interaction.editReply({ content: "❌ Hittade inte loggkanalen." });

        try {
            const fetchedLogs = await logChannel.messages.fetch({ limit: 100 });
            let totalClosed = 0, staffLeaderboard = {};

            fetchedLogs.forEach(msg => {
                if (msg.embeds.length > 0 && msg.embeds.title === '🔒 Ticket Raderad & Loggad') {
                    totalClosed++;
                    const staffField = msg.embeds.fields.find(f => f.name === 'Raderad av');
                    if (staffField) {
                        const staffMention = staffField.value;
                        staffLeaderboard[staffMention] = (staffLeaderboard[staffMention] || 0) + 1;
                    }
                }
            });

            let leaderboardText = Object.entries(staffLeaderboard)
                .sort((a, b) => b - a)
                .map(([staff, count], i) => (i + 1) + ". " + staff + " – **" + count + "** ärenden")
                .join("\n") || "*Ingen historik hittades.*";

            const statsEmbed = new EmbedBuilder()
                .setTitle("📊 Support-Statistik")
                .addFields(
                    { name: "Totalt hanterade tickets", value: "**" + totalClosed + "** st" },
                    { name: "🏆 Mest aktiva supportrar", value: leaderboardText }
                )
                .setThumbnail(interaction.guild.iconURL())
                .setColor("#7289DA");

            await interaction.editReply({ embeds: [statsEmbed] });
        } catch (err) { await interaction.editReply({ content: "❌ Fel vid generering." }); }
    }
    
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup-ticket') {
        const embed = new EmbedBuilder()
            .setTitle('Server Support & Ärenden')
            .setDescription(
                '### 🎫 Välkommen till Serverns Support\n' +
                'Behöver du hjälp, vill rapportera något eller har frågor? Välj den kategori i menyn nedan som passar ditt ärende bäst.\n\n' +
                '**⚠️ VIKTIGA REGLER:**\n' +
                '• **Beskriv ditt ärende** – Skriv direkt vad du behöver hjälp med när kanalen har skapats.\n' +
                '• **Tagga INTE staff** – Om du taggar personal inuti din ticket kommer ärendet att **stängas direkt**.\n' +
                '• **Respektera reglerna** – Vi hjälper dig så fort vi kan, vänligen visa tålamod.\n\n' +
                '*Tack för din förståelse och för att du hjälper oss hålla supporten organiserad!*'
            )
            .setThumbnail(interaction.guild.iconURL())
            .setColor('#5865F2');

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_ticket_type').setPlaceholder('Välj typ av ärende...')
            .addOptions([
                { label: 'Allmän Support', value: 'general', emoji: '💬', description: 'Hjälp med inställningar.' },
                { label: 'Rapportera Spelare', value: 'report', emoji: '🛡️', description: 'Anmäl regelbrott.' },
                { label: 'Donationer & Shop', value: 'donate', emoji: '💎', description: 'Frågor gällande köp.' }
            ]);

        await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(selectMenu)] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_ticket_type') {
        const guild = interaction.guild, member = interaction.user;
        
        // FIX: Hämtar ut det första textelementet ur listan [0] så det inte kraschar
        const ticketType = interaction.values[0]; 

        let categoryId = process.env.CATEGORY_GENERAL, prefix = 'ticket';
        
        if (ticketType === 'report') { categoryId = process.env.CATEGORY_REPORT; prefix = 'rapport'; }
        if (ticketType === 'donate') { categoryId = process.env.CATEGORY_DONATE; prefix = 'donation'; }

        const existingChannel = guild.channels.cache.find(ch => ch.type === ChannelType.GuildText && ch.name.startsWith(prefix + "-") && ch.name.endsWith(member.id));
        if (existingChannel) return interaction.reply({ content: "Du har redan en öppen ticket: <#" + existingChannel.id + ">", flags: [MessageFlags.Ephemeral] });

        await interaction.reply({ content: "Skapar kanal...", flags: [MessageFlags.Ephemeral] });
        await interaction.deleteReply();

        try {
            const ticketChannel = await guild.channels.create({
                name: prefix + "-" + member.username + "-" + member.id,
                type: ChannelType.GuildText, parent: categoryId || null,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                    { id: process.env.STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
                ],
            });

            const ticketEmbed = new EmbedBuilder()
                .setTitle("Supportärende startat: " + ticketType.toUpperCase())
                .setDescription('Beskriv ditt ärende här.\n\n**Hantering:**\nAnvänd knapparna nedan för administration.')
                .setThumbnail(interaction.guild.iconURL()).setColor('#2ECC71');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('claim_ticket').setLabel('Ta över ärende').setStyle(ButtonStyle.Success).setEmoji('📌'),
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Stäng').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
                new ButtonBuilder().setCustomId('add_user_menu').setLabel('Bjud in').setStyle(ButtonStyle.Primary).setEmoji('➕'),
                new ButtonBuilder().setCustomId('remove_user_menu').setLabel('Spärra').setStyle(ButtonStyle.Secondary).setEmoji('➖')
            );

            await ticketChannel.send({ content: "<@" + member.id + "> • <@&" + process.env.STAFF_ROLE_ID + ">", embeds: [ticketEmbed], components: [row] });
        } catch (error) { console.error(error); }
    }

    if (interaction.isButton() && interaction.customId === 'claim_ticket') {
        if (!interaction.member.roles.cache.has(process.env.STAFF_ROLE_ID)) return interaction.reply({ content: 'Endast staff!', flags: [MessageFlags.Ephemeral] });
        await interaction.channel.permissionOverwrites.edit(process.env.STAFF_ROLE_ID, { ViewChannel: true, SendMessages: false });
        await interaction.channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
        await interaction.channel.setName("🔒-" + interaction.channel.name);

        const updatedRow = new ActionRowBuilder();
        interaction.message.components[0].components.forEach(component => {
            const button = ButtonBuilder.from(component);
            if (component.customId === 'claim_ticket') button.setDisabled(true).setLabel('Hanteras av dig').setStyle(ButtonStyle.Secondary);
            updatedRow.addComponents(button);
        });

        await interaction.update({ components: [updatedRow] });
        await interaction.followUp({ content: "📌 Denna ticket har tagits över av <@" + interaction.user.id + ">." });
    }

    if (interaction.isButton() && interaction.customId === 'add_user_menu') {
        const row = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('add_user_action').setPlaceholder('Välj medlem...'));
        await interaction.reply({ content: 'Vem vill du bjuda in?', components: [row], flags: [MessageFlags.Ephemeral] });
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'add_user_action') {
        const targetUser = interaction.users.first();
        await interaction.channel.permissionOverwrites.edit(targetUser.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
        await interaction.reply({ content: "✅ <@" + targetUser.id + "> har lagts till." });
    }

    if (interaction.isButton() && interaction.customId === 'remove_user_menu') {
        const row = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('remove_user_action').setPlaceholder('Välj medlem...'));
await interaction.reply({ content: 'Vem vill du ta bort?', components: [row], flags: [MessageFlags.Ephemeral] });
}
if (interaction.isUserSelectMenu() && interaction.customId === 'remove_user_action') {
const targetUser = interaction.users.first();
if (interaction.channel.name.includes(targetUser.username.toLowerCase())) return interaction.reply({ content: 'Kan inte ta bort skaparen!', flags: [MessageFlags.Ephemeral] });
await interaction.channel.permissionOverwrites.delete(targetUser.id);
await interaction.reply({ content: "❌ Medlemmen borttagen." });
}
if (interaction.isButton() && interaction.customId === 'close_ticket') {
await interaction.reply({ content: 'Låser kanalen...', flags: [MessageFlags.Ephemeral] });
await interaction.deleteReply();
const memberId = interaction.channel.name.split('-').pop();
try {
await interaction.channel.permissionOverwrites.edit(memberId, { SendMessages: false });
await interaction.channel.setName("closed-" + memberId);
} catch (err) {}
const row = new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId('reopen_ticket').setLabel('Öppna igen').setStyle(ButtonStyle.Success).setEmoji('🔓'),
new ButtonBuilder().setCustomId('request_feedback').setLabel('Begär betyg').setStyle(ButtonStyle.Primary).setEmoji('⭐'),
new ButtonBuilder().setCustomId('delete_ticket').setLabel('Radera permanent').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
);
await interaction.channel.send({ content: '🔒 Ticket arkiverad. Välj åtgärd för hantering:', components: [row] });
}
if (interaction.isButton() && interaction.customId === 'reopen_ticket') {
await interaction.reply({ content: 'Öppnar igen...', flags: [MessageFlags.Ephemeral] });
await interaction.deleteReply();
const memberId = interaction.channel.name.split('-').pop();
try {
await interaction.channel.permissionOverwrites.edit(memberId, { SendMessages: true });
await interaction.channel.setName("ticket-" + memberId);
} catch (err) {}
await interaction.message.delete();
await interaction.channel.send({ content: '🔓 Ticketen har återöppnats och låsts upp för användaren.' });
}
if (interaction.isButton() && interaction.customId === 'request_feedback') {
const memberId = interaction.channel.name.split('-').pop();
try {
const targetUser = await client.users.fetch(memberId);
const ratingMenu = new StringSelectMenuBuilder().setCustomId('submit_rating_' + interaction.channel.id).setPlaceholder('Välj ditt betyg...')
.addOptions([
{ label: '⭐⭐⭐⭐⭐ Utmärkt', value: '5' },
{ label: '⭐⭐⭐⭐ Bra', value: '4' },
{ label: '⭐⭐⭐ Godkänt', value: '3' },
{ label: '⭐⭐ Dåligt', value: '2' },
{ label: '⭐ Uselt', value: '1' }
]);
await targetUser.send({ content: 'Ge betyg på supporten:', components: [new ActionRowBuilder().addComponents(ratingMenu)] });
await interaction.reply({ content: '✅ Förfrågan skickad till PM.', flags: [MessageFlags.Ephemeral] });
} catch (err) { await interaction.reply({ content: '❌ Kunde inte skicka PM.', flags: [MessageFlags.Ephemeral] }); }
}
if (interaction.isStringSelectMenu() && interaction.customId.startsWith('submit_rating_')) {
const ticketChannelId = interaction.customId.replace('submit_rating_', ''), rating = interaction.values[0];
const logChannel = client.channels.cache.get(process.env.LOG_CHANNEL_ID);
if (logChannel) {
const embed = new EmbedBuilder().setTitle('⭐ Nytt Supportbetyg')
.addFields({ name: 'Användare', value: interaction.user.toString() }, { name: 'Betyg', value: rating + " / 5" })
.setColor('#E67E22').setTimestamp();
await logChannel.send({ embeds: [embed] });
}
await interaction.update({ content: 'Tack för ditt betyg!', components: [] });
}
if (interaction.isButton() && interaction.customId === 'delete_ticket') {
await handleTicketDeletion(interaction.channel, interaction.user);
}
});
async function handleTicketDeletion(channel, closedByAuthor) {
const memberId = channel.name.split('-').pop();
try {
const messages = await channel.messages.fetch({ limit: 100 });
const sortedMessages = Array.from(messages.values()).reverse();
let authorTag = closedByAuthor ? closedByAuthor.tag : "SYSTEM (INAKTIVITET)";
let logText = "LOGG FÖR TICKET: " + channel.name + "\n" + "Stängd av: " + authorTag + "\n" + "=========================================\n\n";
for (const msg of sortedMessages) {
if (msg.author.bot && msg.embeds.length > 0) continue;
logText += "[" + msg.createdAt.toLocaleString('sv-SE') + "] " + msg.author.tag + ": " + msg.content + "\n";
}
const attachment = new AttachmentBuilder(Buffer.from(logText, 'utf-8'), { name: "log-" + channel.name + ".txt" });
const logChannel = client.channels.cache.get(process.env.LOG_CHANNEL_ID);
if (logChannel) {
const embed = new EmbedBuilder().setTitle('🔒 Ticket Raderad & Loggad').addFields({ name: 'Kanal', value: channel.name }, { name: 'Raderad av', value: closedByAuthor ? closedByAuthor.toString() : 'Systemet' }).setColor('#23272A').setTimestamp();
await logChannel.send({ embeds: [embed], files: [attachment] });
}
try {
const targetUser = await client.users.fetch(memberId);
await targetUser.send({ content: 'Ditt ärende har avslutats. Här är din sparade logg:', files: [attachment] });
} catch (e) {}
} catch (err) { console.error(err); }
setTimeout(async () => { try { await channel.delete(); } catch (e) {} }, 2000);
}
async function checkInactiveTickets() {
const guild = client.guilds.cache.get(process.env.GUILD_ID);
if (!guild) return;
const now = Date.now(), oneDayInMs = 24 * 60 * 60 * 1000;
const ticketChannels = guild.channels.cache.filter(ch => ch.type === ChannelType.GuildText && (ch.name.startsWith('ticket-') || ch.name.startsWith('rapport-') || ch.name.startsWith('donation-') || ch.name.startsWith('closed-') || ch.name.startsWith('🔒-')));
for (const [id, channel] of ticketChannels) {
try {
const fetched = await channel.messages.fetch({ limit: 1 });
const lastActive = fetched.first() ? fetched.first().createdTimestamp : channel.createdTimestamp;
if (now - lastActive > oneDayInMs) await handleTicketDeletion(channel, null);
} catch (e) {}
}
}
client.login(process.env.DISCORD_TOKEN);