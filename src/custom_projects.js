import dotenv from "dotenv";
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    Client,
    CommandInteraction,
    EmbedBuilder,
    GatewayIntentBits,
    GuildMember,
    Message,
    TextChannel,
    User
} from "discord.js";
import {ButtonStyle, ChannelType, MessageType, OverwriteType} from "discord-api-types/v10";
import TicketStatus from "./models/ticket/TicketStatus.js";
import SetupStatus from "./models/ticket/TicketSetupStatus.js";
import PluginRates from "./models/ticket/PluginRates.js";
import Ticket from "./models/ticket/Ticket.js";
import TicketRepository from "./repository/TicketRepository.js";

dotenv.config({path: './.env'});

export default class CustomProjects {

    client; //create new client
    orderFromUsChannelId = '965377410335924295';
    categoryId = '965377119423197184';
    ticketInfo = new Map();

    constructor() {
        this.setupClient().then();
    }

    async setupClient() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessageReactions,
                GatewayIntentBits.MessageContent
            ]
        });

        this.client.on('ready', async () => {
            console.log(`Logged in as ${this.client.user.tag}!`);
            await this.sendFirstMessage();
            await this.createCommands();
        });
        this.client.on('messageCreate', async (message) => {
            await this.handleChatMessage(message);
        });
        this.client.on('invalidated', this.restart);
        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isButton()) {
                if (interaction.customId === 'open-ticket') {
                    await this.openTicket(interaction);
                } else if (interaction.customId === "no-deadline") {
                    await this.handleDeadlineSetting(interaction, null);
                }
            } else if (interaction.isCommand()) {
                await this.handleCommand(interaction);
            }
        });

        await this.client.login(process.env.CLIENT_TOKEN_CUSTOM_PROJECTS); //login bot using token
    }

    restart() {
        this.client.destroy();
        setTimeout(() => this.setupClient(), 1000);
    }

    async getCachedTicketFromChannel(channelId, isTicketId = false) {
        for (let [key, value] of this.ticketInfo) {
            if ((value.channelId === channelId) || (isTicketId && key === channelId)) {
                if (value.setupStatus !== SetupStatus.Submitted) break;
                return value;
            }
        }

        const sqlRes = await this.executeSQL(`SELECT *
                                              FROM plugin_request_ticket
                                              WHERE ${isTicketId ? "id" : "discord_channel_id"} = ?`, [channelId]);
        if (sqlRes == null || sqlRes.length === 0) return null;
        else {
            const ticket = Ticket.fromJson(sqlRes[0]);

            const ticketObject = {
                ticketId: ticket.id,
                id: ticket.id,
                requester: ticket.requester,
                description: ticket.plugin_description,
                setupStatus: ticket.setup_status,
                status: ticket.status,
                createdAt: ticket.created_at,
                updatedAt: ticket.updated_at,
                channelId: ticket.discord_channel_id,
                serverName: ticket.server_name,
                deadline: ticket.deadline,
                lastMessageId: ticket.last_discord_message
            };
            this.ticketInfo.set(ticket.id, ticket);
            return ticketObject;
        }
    }

    /**
     * @param {CommandInteraction} interaction
     * @returns {Promise<void>}
     */
    async handleCommand(interaction) {
        if (interaction.commandName !== "order") return;

        const subcommand = interaction.options.getSubcomand(false);
        switch (subcommand) {
            case "create":
                await this.openTicket(interaction);
                break;
            case "close":
                if (!await this.checkForChannelId(interaction)) break;
                await this.closeTicket(interaction, interaction.options.getBoolean("approve", false) ?? null);
                break;
            case "adduser":
                if (!await this.checkForChannelId(interaction)) break;
                await this.addUserToTicket(interaction, interaction.options.getUser("user", false) ?? null);
                break;
            case "removeuser":
                if (!await this.checkForChannelId(interaction)) break;
                await this.removeUserFromTicket(interaction, interaction.options.getUser("user", false) ?? null);
                break;
        }
    }

    /**
     * Reply to an interaction with an embed and delete it after a certain time.
     * @param {CommandInteraction|ButtonInteraction} interaction Interaction to reply to.
     * @param {string} title Title of the embed.
     * @param {string} description Description of the embed.
     * @param {string} color Color of the embed. Set to null for default.
     * @param {boolean} ephemeral Whether the reply should be ephemeral.
     * @param {number|boolean} deleteAfter Time in ms after which the reply should be deleted. Set to false to disable.
     * @returns {Promise<void>}
     */
    async replyEmbedWithAutoDelete(interaction, title, description, color, ephemeral = true, deleteAfter = 5000) {
        const embed = this.getEmbed(title, description, color);
        const sent = await interaction.reply({embeds: [embed], fetchReply: true, ephemeral: ephemeral});

        if (deleteAfter && deleteAfter > 0) setTimeout(() => {
            if (sent.deletable) interaction.deleteReply();
        }, deleteAfter);
    }

    /**
     * @param {CommandInteraction} interaction
     * @param {User} user     * @returns {Promise<void>}
     */
    async addUserToTicket(interaction, user) {
        if (user == null) {
            await this.replyEmbedWithAutoDelete(interaction, "User not found", "Please enter a valid user", "#f54257");
            return;
        }

        if (interaction.user.id === user.id) {
            await this.replyEmbedWithAutoDelete(interaction, "That's you!", "You can't add yourself to this order since you already have access.", "#f54257");
            return;
        }

        const found = await interaction.channel.permissionOverwrites.cache.find(search => search.id === user.id);
        if (found != null) {
            await this.replyEmbedWithAutoDelete(interaction, "User already has access", "That user already has access to this order.", "#f54257");
            return;
        }

        this.giveUserPermission(interaction.channel, user).catch(console.error);
        await this.replyEmbedWithAutoDelete(
            interaction, "User added", `<@${user.id}> has been added to this order by <@${interaction.user.id}>.`,
            "#f58a42", false, false
        );
    }

    /**
     * @param {CommandInteraction} interaction
     * @param {User} user
     * @returns {Promise<void>}
     */
    async removeUserFromTicket(interaction, user) {
        if (user == null) {
            await this.replyEmbedWithAutoDelete(interaction, "User not found", "Please enter a valid user", "#f54257");
            return;
        }

        if (interaction.user.id === user.id) {
            await this.replyEmbedWithAutoDelete(interaction,
                "That's you!",
                "You can't remove yourself from this order since you opened it. If you wish to close this order, please use `/order close`.",
                "#f54257"
            );
            return;
        }

        if (user.bot) {
            await this.replyEmbedWithAutoDelete(interaction, "That's a bot!", "You can't remove bots from this order.", "#f54257")
            return;
        }

        const member = await interaction.guild.members.fetch(user.id);
        if (this.isAdmin(member)) {
            await this.replyEmbedWithAutoDelete(interaction, "That's a staff member!", "You can't remove staff members from this order.", "#f54257")
            return;
        }

        const found = await interaction.channel.permissionOverwrites.cache.find(search => search.id === user.id);
        if (found == null) {
            await this.replyEmbedWithAutoDelete(interaction, "User has no access", "That user does not have access to this order.", "#f54257")
            return;
        }

        interaction.channel.permissionOverwrites.delete(user.id);
        await this.replyEmbedWithAutoDelete(interaction, "User removed", `<@${user.id}> has been removed from this order by <@${interaction.user.id}>.`, "#f58a42", false, false);
    }

    /**
     * @param {CommandInteraction} interaction
     * @returns {Promise<boolean>}
     */
    async checkForChannelId(interaction) {
        if (interaction.channelId == null) {
            await this.replyEmbedWithAutoDelete(interaction, "Please execute this command in a channel!", "This command has to be executed in an order channel.", "#f54257");
            return false;
        }

        const found = await TicketRepository.shared.fetchTicketByChannelId(interaction.channelId);
        if (!found) {
            await this.replyEmbedWithAutoDelete(interaction, "No order found!",
                "There is no order associated with the channel that you are executing this command from. " +
                "Please execute this command from the channel that is linked to the order that you're trying to execute an action on.", "#f54257", 8000)
            return false;
        }

        if (!this.canUserModerateTicket(found, interaction.user)) {
            await this.replyEmbedWithAutoDelete(interaction, "No permission!", "You are not allowed to execute this action on this order.", "#f54257");
            return false;
        }
        return true;
    }

    /**
     * @param {TextChannel} channel
     */
    revokeAccess(channel) {
        channel.permissionOverwrites.cache.forEach(async (value, user) => {
            if (value.type === OverwriteType.Member) {
                await channel.permissionOverwrites.edit(await this.client.users.fetch(user, {force: true}), {
                    'AddReactions': true,
                    'AttachFiles': true,
                    'ReadMessageHistory': true,
                    'SendMessages': false,
                    'ViewChannel': true
                });
            }
        });
    }

    /**
     * @param {CommandInteraction} interaction
     * @param {boolean|null} approve
     * @returns {Promise<void>}
     */
    async closeTicket(interaction, approve = null) {
        const ticket = await TicketRepository.shared.fetchTicketByChannelId(interaction.channelId);
        if (!ticket) return;

        if (this.isAdmin(interaction.user) || approve == null) {
            await this.replyEmbedWithAutoDelete(interaction, "Order closed!", `${interaction.user} has closed the order.`, "#f58a42", false, false);

            this.revokeAccess(interaction.channel);
            await this.executeSQL("UPDATE plugin_request_ticket SET status = ? WHERE discord_channel_id = ?", [TicketStatus.Closed, interaction.channelId]);

            interaction.channel.setName(`order-${ticketId[0].id}-closed`);
            this.ticketInfo.delete(ticketId[0].id);
            return;
        }

        // revoking access to the channel when an admin denies the ticket.
        if (!approve) {
            this.revokeAccess(interaction.channel);
            interaction.channel.setName(`order-${ticketId[0].id}-closed`);
            this.ticketInfo.delete(ticketId[0].id);
        }
        await this.executeSQL("UPDATE plugin_request_ticket SET status = ? WHERE discord_channel_id = ?", [approve ? TicketStatus.Approved : TicketStatus.Denied, interaction.channelId]);

        await this.replyEmbedWithAutoDelete(interaction,
            `Order ${approve ? "approved" : "denied"}!`,
            `<@${interaction.user.id}> has ${approve ? "approved" : "denied"} the order.`,
            "#f58a42", false, false
        );
    }

    async createCommands() {
        const cmds = {
            type: 1,
            name: 'order',
            description: 'Create a new order for ordering a custom plugin.',
            options: [
                {
                    type: 1,
                    name: 'create',
                    description: 'Open a new custom plugin ordering order.',
                },
                {
                    type: 1,
                    name: 'close',
                    description: 'Close the current custom plugin ordering order.',
                    options: [
                        {
                            type: 5,
                            name: 'approve',
                            description: 'Whether to approve the request (Admins) .',
                            required: false,
                        }
                    ]
                },
                {
                    type: 1,
                    name: 'adduser',
                    description: 'Add another user to the current custom plugin ordering order.',
                    options: [
                        {
                            type: 6,
                            name: 'user',
                            description: 'The user to add to the order.',
                            required: true,
                        }
                    ]
                },
                {
                    type: 1,
                    name: 'removeuser',
                    description: 'Remove a user from the current custom plugin ordering order.',
                    options: [
                        {
                            type: 6,
                            name: 'user',
                            description: 'The user to remove from the order.',
                            required: true,
                        }
                    ]
                },
            ]
        };

        this.client.application.commands.create(cmds)
            .catch(console.log);
    }

    /**
     * @param {TextChannel} channel
     * @param {User} user
     * @returns {Promise<void>}
     */
    async giveUserPermission(channel, user) {
        await channel.permissionOverwrites.create(user, {
            'AddReactions': true,
            'AttachFiles': true,
            'ReadMessageHistory': true,
            'SendMessages': true,
            'ViewChannel': true
        }, {type: 1, reason: 'Give user permission to access channel'});
    }

    /**
     * @param {GuildMember} user
     * @returns {*}
     */
    isAdmin(user) {
        return user.roles.cache.some(role => role.id === process.env.ADMIN_ROLE_ID || role.id === process.env.MODERATOR_ROLE_ID);
    }

    /**
     * @param {Message} message
     * @returns {Promise<void>}
     */
    async handleChatMessage(message) {
        if ((message.channel.parentId === this.categoryId && message.type === MessageType.ChannelPinnedMessage) ||
            (message.channel.id === this.orderFromUsChannelId && !message.author.bot)) {
            message.delete().catch(console.error);
            return;
        }
        if (message.author.bot) return;

        if (message.channel.parentId !== this.categoryId) {
            return;
        }

        const ticketInfo = await this.getCachedTicketFromChannel(message.channel.id);
        if (ticketInfo == null || ticketInfo.setupStatus === SetupStatus.Submitted) {
            return;
        }

        if (ticketInfo.setupStatus === SetupStatus.Budgeting) {
            if (!this.isAdmin(message.member)) {
                if (message?.deletable) message.delete().catch(console.error);
            }
            return;
        }

        if (ticketInfo.setupStatus === SetupStatus.EnterServerName) {
            message.delete().catch(console.error);
            if (message.content.length > 35) {
                const embed = this.getEmbed("Server name too long", "The server name that you entered is too long. Please enter a server name with less than 35 characters", "#f54257");
                const sent = await message.channel.send({embeds: [embed]});
                setTimeout(() => {
                    if (sent?.deletable) sent.delete();
                }, 5000);
                return;
            }

            ticketInfo.setupStatus = SetupStatus.EnterDeadline;
            ticketInfo.serverName = message.content;
            this.setTicketSQLValue(ticketInfo.ticketId, 'server_name', message.content, SetupStatus.EnterDeadline).catch(console.error);

            const embed = this.getEmbed(`When is the deadline for this product?`, null);
            const interactions = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('no-deadline')
                    .setStyle(ButtonStyle.Primary)
                    .setLabel('I have no deadline')
                    .setEmoji('♾️')
            );

            this.deleteLastMessage(ticketInfo, message.channel).catch(console.error);

            const sent = await message.channel.send({embeds: [embed], components: [interactions]});
            ticketInfo.lastMessageId = sent.id;
            this.setTicketSQLValue(ticketInfo.ticketId, 'last_discord_message', sent.id).catch(console.error);
        } else if (ticketInfo.setupStatus === SetupStatus.EnterDeadline) {
            if (message?.deletable) message.delete().catch(console.error);
            this.handleDeadlineSetting(message.channel, message.content).catch(console.error);
        } else if (ticketInfo.setupStatus === SetupStatus.EnterProjectDescription) {
            if (message?.deletable) message.delete().catch(console.error);

            ticketInfo.description = message.content;
            ticketInfo.setupStatus = SetupStatus.Submitted;
            await this.setTicketSQLValue(ticketInfo.ticketId, 'plugin_description', message.content, SetupStatus.Submitted);

            await this.sendSummary(message.channel, ticketInfo.ticketId);

            const embed = this.getEmbed(`:white_check_mark:  Thanks for answering the questions!`, "We will get back to you as soon as possible.");

            this.deleteLastMessage(ticketInfo, message.channel).catch(console.error);

            delete ticketInfo.lastMessageId;
            this.setTicketSQLValue(ticketInfo.ticketId, 'last_discord_message', null).catch(console.error);

            message.channel.send({content: `<@&${process.env.ADMIN_ROLE_ID}>`, embeds: [embed]});
        }
    }

    async deleteLastMessage(ticketInfo, channel) {
        if (ticketInfo.lastMessageId == null) return;

        try {
            const previousMsg = await channel.messages.fetch(ticketInfo.lastMessageId);
            if (previousMsg?.deletable) previousMsg?.delete().catch(console.error);
        } catch (e) {
            console.log(e);
        }
    }

    async sendSummary(channel) {
        let ticketInfo = await this.getCachedTicketFromChannel(channel.id);
        if (ticketInfo == null) return;

        const embed = this.getEmbed(`Project Summary`, "Here is a summary of the information that you entered about this project.");
        embed.addFields()
        embed.addFields(
            {name: "Server Name", value: ticketInfo.serverName ?? ":no_entry_sign:  No server name entered", inline: true},
            {name: "Deadline", value: ticketInfo.deadline ?? ":infinity: I have no deadline", inline: true},
            {name: "Project Description", value: ticketInfo.description ?? ":no_entry_sign:  No project description entered", inline: false}
        );
        embed.setFooter({text: 'If you have any additional information, please use this channel to communicate with us.'});

        const sent = await channel.send({embeds: [embed]});
        sent?.pin().catch(console.error);
    }

    /**
     * Handles the deadline setting
     * @param {ButtonInteraction} interaction The interaction
     * @param value
     * @returns {Promise<void>}
     */
    async handleDeadlineSetting(interaction, value) {
        const ticketInfo = await this.getCachedTicketFromChannel(interaction.channel.id);
        if (ticketInfo == null) return;

        if (value != null && value.length > 256) {
            await this.replyEmbedWithAutoDelete(interaction, "Deadline is too long", "The deadline that you entered is too long. Please enter a deadline that is less than 256 characters.", "#f54257");
            return;
        }

        ticketInfo.deadline = value;
        ticketInfo.setupStatus = SetupStatus.EnterProjectDescription;
        this.setTicketSQLValue(ticketInfo.ticketId, 'deadline', value, SetupStatus.EnterProjectDescription).catch(console.error);

        const embed = this.getEmbed(`Please describe your project in as much detail as possible.`, null);

        this.deleteLastMessage(ticketInfo, interaction.channel).catch(console.error);

        const sent = await interaction.channel.send({embeds: [embed]});
        ticketInfo.lastMessageId = sent.id;
        this.setTicketSQLValue(ticketInfo.ticketId, 'last_discord_message', sent.id, null).catch(console.error);
    }

    /**
     * Change the value of a ticket.
     * @param ticketId {string} The id of the ticket.
     * @param key {string} The name of the MySQL table column to alter its value.
     * @param value The new value of the column.
     * @param setupStatus {null|string} The current setup status. Set to null to keep the current status.
     * @returns {Promise<null|array>}
     */
    setTicketSQLValue(ticketId, key, value, setupStatus = null) {
        const clas = this;
        return new Promise(async function (ok, fail) {
            const con = clas.#getConnection();
            con.connect(function (err) {
                if (err) {
                    fail(err);
                    return;
                }

                let statusPart = "";
                if (setupStatus != null) {
                    statusPart = `, setup_status = '${setupStatus}'`
                }

                con.query(`UPDATE plugin_request_ticket
                           SET ${key} = ? ${statusPart}
                           WHERE id = ?`, [value, ticketId],
                    function (err, result) {
                        if (err) {
                            fail(err);
                            return;
                        }
                        ok(result ?? null);
                    });
            });
        });
    }

    async openTicket(interaction) {
        const guild = interaction.guild;
        try {
            if (await TicketRepository.shared.hasUserOpenTicket(interaction.user.id)) {
                await this.replyEmbedWithAutoDelete(interaction,
                    "You already have an open ticket",
                    "You already have an open ticket. Please close it before opening a new one.",
                    "#f54257");
                return;
            }

            const number = (Math.random() * 100).toString();
            const created = await guild.channels.create({
                name: "ticket-" + number,
                type: ChannelType.GuildText,
                parent: this.categoryId,
                topic: `Custom plugin ticket for ${interaction.user.username}.`
            });
            await created.permissionOverwrites.edit(guild.roles.everyone, {
                'ViewChannel': false,
                'SendMessages': false,
                'ReadMessageHistory': false
            });

            await this.giveUserPermission(created, interaction.user);

            await this.replyEmbedWithAutoDelete(interaction, "Ticket created!", `Ticket with channel <#${created.id}> has been created!`, "#00ff00", true);
            this.sendFirstTicketMessage(await created.fetch(true), interaction.user).catch(console.error);
        } catch (e) {
            console.error(e);
            const msg = "Something went wrong. Please try again later.";
            if (interaction.replied) {
                await interaction.followUp({content: msg, ephemeral: true});
            } else {
                await interaction.reply({content: msg, ephemeral: true});
            }
        }
    }

    async createTicket(channelId, userId) {
        return this.executeSQL(`INSERT INTO plugin_request_ticket (requester_discord_id, discord_channel_id)
                                VALUES (?, ?)`, [userId, channelId]);
    }

    createToken(length) {
        let result = '';
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.=';
        const charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() *
                charactersLength));
        }
        return result;
    }

    async createPricingLink(ticket) {
        const id = this.createToken(32);
        const token = this.createToken(32);
        try {
            const pricing = await this.executeSQL(`INSERT INTO plugin_request_pricing (id, token, ticket)
                                                   VALUES (?, ?, ?)`, [id, token, ticket]);
            if (pricing != null) return `${process.env.WEBSITE_URL}/new-pricing?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}&ticket_id=${ticket}`;
        } catch (e) {
            console.error(e);
        }
        return null;
    }

    async handlePricingUpdate(pricingId, ticketId, body) {
        const currentTicketInfo = await this.getCachedTicketFromChannel(body.ticket_id, true);
        if (currentTicketInfo == null) {
            return;
        }

        const channel = await this.client.channels.fetch(currentTicketInfo.channelId);
        if (channel == null) {
            return;
        }

        const pricingMessage = await channel.messages.fetch(currentTicketInfo.lastMessageId);
        if (pricingMessage && pricingMessage?.deletable) pricingMessage.delete().catch(console.error);

        const pricingEmbed = this.getEmbed("Pricing Summary", "Here is a summary of the pricing options that you selected for this project.");
        const typeRate = PluginRates.type[body.type].rate;
        pricingEmbed.addFields({
            name: "Plugin type",
            value: `${PluginRates.descriptions[body.type]} - ${typeRate} EUR / hour\n${PluginRates.type[body.type].description}`,
            inline: true
        });

        const testingRate = PluginRates.testing[body.testing].rate;
        const testingPrice = body.testing === body.type ? "Included" : `${testingRate} EUR`;
        pricingEmbed.addFields({
            name: "Testing",
            value: `${PluginRates.descriptions[body.testing]} - ${testingPrice}\n${PluginRates.testing[body.testing].description}`,
            inline: true
        });

        const messagesRate = PluginRates.messages[body.messages].rate;
        pricingEmbed.addFields({
            name: "Messages & Items",
            value: `${PluginRates.descriptions[body.messages]} - ${messagesRate} EUR\n${PluginRates.messages[body.messages].description}`,
            inline: true
        });

        const commandsRate = PluginRates.commands[body.commands].rate;
        pricingEmbed.addFields({
            name: "Commands",
            value: `${PluginRates.descriptions[body.commands]} - ${commandsRate} EUR\n${PluginRates.commands[body.commands].description}`,
            inline: true
        });

        const versionsRate = PluginRates.versions[body.versions].rate;
        pricingEmbed.addFields({
            name: "Versions",
            value: `${PluginRates.descriptions[body.versions]} - ${versionsRate} EUR\n${PluginRates.versions[body.versions].description}`,
            inline: true
        });

        if (body.allow_publication) {
            pricingEmbed.addFields({name: "Publication", value: `${PluginRates.allow_publication.rate} EUR\n${PluginRates.allow_publication.description}`});
        }

        let total = testingRate + messagesRate + commandsRate + versionsRate + (body.allow_publication ? PluginRates.allow_publication.rate : 0);
        if (body.type == 'premium' && body.testing == "premium") total -= testingRate;
        else if (body.type == 'pro' && body.testing == "pro") total -= testingRate;

        const totalMsg = total === 0 ? "" : (total > 0 ? `+ ${total} EUR` : `- ${(total * -1)} EUR`)

        pricingEmbed.addFields({name: "Total", value: `${typeRate} EUR / hour ${totalMsg}`});
        pricingEmbed.setFooter({text: 'This pricing is final and cannot be changed.'});

        channel.send({embeds: [pricingEmbed]});

        const embed = this.getEmbed("What is the name of your server?", null);
        const sentMsg = await channel.send({embeds: [embed]});

        sentMsg.pin().catch(console.error);

        currentTicketInfo.setupStatus = SetupStatus.EnterServerName;
        currentTicketInfo.lastMessageId = sentMsg.id;
        this.setTicketSQLValue(currentTicketInfo.ticketId, "last_discord_message", sentMsg.id, SetupStatus.EnterServerName).catch(console.error);
    }

    getEmbed(title, description = null, color = process.env.THEME_COLOR) {
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor(color);
        if (description != null) embed.setDescription(description);
        return embed;
    }

    /**
     * @param {TextChannel} channel
     * @param {GuildMember} user
     * @returns {Promise<void>}
     */
    async sendFirstTicketMessage(channel, user) {
        const ticketRes = await this.createTicket(channel.id, user.id);

        const ticket = ticketRes.insertId;
        await channel.setName(`ticket-${ticket}`);

        const currentTicketInfo = await this.getCachedTicketFromChannel(channel.id);

        const embed = this.getEmbed(
            "Welcome to your custom plugin ticket!",
            `Hello <@${user.id}>,\n\nWelcome to your custom plugin ticket with id #${ticket}!\nWe will be asking you a couple of questions regarding your request.`
        );

        await channel.send({content: `<@${user.id}>`, embeds: [embed]});

        const firstMsg = this.getEmbed(
            "Pricing",
            "We have created a custom link for this ticket so you can easily select your pricing budgets per category. " +
            "Please select your pricing on the given link and click 'Submit' at the bottom of the page when you are done.\n\n" +
            await this.createPricingLink(ticket)
        );

        const sent = await channel.send({embeds: [firstMsg]});
        currentTicketInfo.lastMessageId = sent.id;
        this.setTicketSQLValue(ticket, "last_discord_message", sent.id).catch(console.error);
    }

    async sendFirstMessage() {
        const channel = await this.client.channels.fetch(this.orderFromUsChannelId);

        const pinnedMessages = await channel.messages.fetchPinned(false);
        if (pinnedMessages.size !== 0) return;

        const embed = this.getEmbed(
            "Let's make your Minecraft dream come true!",
            "**Click the button below to get started!**\nWe will create you a personal ticket channel that we will use to discuss the project with you."
        );

        const actionRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setEmoji('🎟️')
                    .setLabel('Open a ticket!')
                    .setStyle(ButtonStyle.Primary)
                    .setCustomId('open-ticket')
            );

        const sent = await channel.send({embeds: [embed], components: [actionRow]});
        sent.pin().catch(console.error);
    }

    /**
     * @param {Ticket} ticket
     * @param {User} user
     */
    canUserModerateTicket(ticket, user) {
        if (ticket?.requester_discord_id === user.id) return true;

        return this.isAdmin(this.getGuildMember(user));
    }

    getGuildMember(user) {
        const guild = this.client.guilds.cache.get(process.env.GUILD_ID);
        return guild.members.cache.get(user.id);
    }

}