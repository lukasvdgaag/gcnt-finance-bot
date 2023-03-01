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
import {RepositoryManager} from "./index.js";

export default class CustomProjects {

    client; //create new client
    orderFromUsChannelId = '965377410335924295';
    categoryId = '965377119423197184';
    
    ticketRepository;
    projectPricingRepository;

    constructor() {
        this.setupClient().then();
        this.ticketRepository = RepositoryManager.ticketRepository;
        this.projectPricingRepository = RepositoryManager.projectPricingRepository;
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

        const token = process.env.CLIENT_TOKEN_CUSTOM_PROJECTS;
        await this.client.login(token); //login bot using token
    }

    restart() {
        this.client.destroy();
        setTimeout(() => this.setupClient(), 1000);
    }

    /**
     * @param {CommandInteraction} interaction
     * @returns {Promise<void>}
     */
    async handleCommand(interaction) {
        if (interaction.commandName !== "order") return;

        const subcommand = interaction.options.getSubcommand(false);
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
            await this.replyEmbedWithAutoDelete(interaction, "That's you!", "You can't add yourself to this order since you already have access.", "#f54257", true, false);
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

        if (this.isAdmin(this.getGuildMember(user))) {
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

        const found = await this.ticketRepository.fetchTicketByChannelId(interaction.channelId);
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
                await channel.permissionOverwrites.edit(await this.client.users.fetch(user, {force: true}).catch(console.error), {
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
        const ticket = await this.ticketRepository.fetchTicketByChannelId(interaction.channelId);
        if (!ticket) return;

        if (!this.isAdmin(this.getGuildMember(interaction.user)) || approve == null) {
            await this.replyEmbedWithAutoDelete(interaction, "Order closed!", `${interaction.user} has closed the order.`, "#f58a42", false, false);

            this.revokeAccess(interaction.channel);

            ticket.status = TicketStatus.Closed;
            await this.ticketRepository.updateTicket(ticket);

            await interaction.channel.setName(`ticket-${ticket.id}-closed`);
            this.ticketRepository.removeCachedTicket(ticket);
            return;
        }

        // revoking access to the channel when an admin denies the ticket.
        if (!approve) {
            this.revokeAccess(interaction.channel);
            await interaction.channel.setName(`ticket-${ticket.id}-closed`);
            this.ticketRepository.removeCachedTicket(ticket);
        } else {
            await interaction.channel.setName(`ticket-${ticket.id}`);
        }

        ticket.status = approve ? TicketStatus.Approved : TicketStatus.Denied;
        await this.ticketRepository.updateTicket(ticket);

        await this.replyEmbedWithAutoDelete(interaction,
            `Order ${approve ? "approved" : "denied"}!`,
            `<@${interaction.user.id}> has ${approve ? "approved" : "denied"} the order.`,
            "#f58a42", false, false
        );
    }

    async createCommands() {
        const cmds = [{
            type: 1,
            name: 'order',
            description: 'Create a new custom project request order ticket.',
            options: [
                {
                    type: 1,
                    name: 'create',
                    description: 'Open a new custom project request ticket.',
                },
                {
                    type: 1,
                    name: 'close',
                    description: 'Close the current custom project request ticket.',
                    options: [
                        {
                            type: 5,
                            name: 'approve',
                            description: 'Whether to approve the request (Admins).',
                            required: false,
                        }
                    ]
                },
                {
                    type: 1,
                    name: 'adduser',
                    description: 'Add another user to the current custom project request ticket.',
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
                    description: 'Remove a user from the current custom project request ticket.',
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
        }];

        this.client.application.commands.set(cmds)
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
            if (message?.deletable) message.delete().catch(console.error);
            return;
        }
        if (message.author.bot) return;

        if (message.channel.parentId !== this.categoryId) {
            return;
        }

        const ticket = await this.ticketRepository.fetchTicketByChannelId(message.channel.id);
        if (!ticket || ticket.setup_status === SetupStatus.Submitted) {
            return;
        }

        if (ticket.setup_status === SetupStatus.Budgeting) {
            if (!this.isAdmin(message.member)) {
                if (message?.deletable) message.delete().catch(console.error);
            }
            return;
        }

        if (ticket.setup_status === SetupStatus.EnterName) {
            if (message?.deletable) message.delete().catch(console.error);
            if (message.content.length > 255) {
                const embed = this.getEmbed("Project name too long", "The project name that you entered is too long. Please enter a project name with less than 255 characters", "#f54257");
                const sent = await message.channel.send({embeds: [embed]});
                setTimeout(() => {
                    if (sent?.deletable) sent.delete();
                }, 5000);
                return;
            }

            ticket.setup_status = SetupStatus.EnterDeadline;
            ticket.name = message.content;

            const embed = this.getEmbed(`When is the deadline for this product?`, null);
            const interactions = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('no-deadline')
                    .setStyle(ButtonStyle.Primary)
                    .setLabel('I have no deadline')
                    .setEmoji('♾️')
            );

            this.deleteLastMessage(ticket, message.channel).catch(console.error);

            const sent = await message.channel.send({embeds: [embed], components: [interactions]});
            ticket.last_discord_message = sent.id;

            await this.ticketRepository.updateTicket(ticket);
        } else if (ticket.setup_status === SetupStatus.EnterDeadline) {
            if (message?.deletable) message.delete().catch(console.error);
            this.handleDeadlineSetting(message, message.content).catch(console.error);
        } else if (ticket.setup_status === SetupStatus.EnterProjectDescription) {
            if (message?.deletable) message.delete().catch(console.error);

            this.deleteLastMessage(ticket, message.channel).catch(console.error);

            ticket.description = message.content;
            ticket.setup_status = SetupStatus.Submitted;
            ticket.last_discord_message = null;

            await this.ticketRepository.updateTicket(ticket);
            await this.sendSummary(message.channel);

            const embed = this.getEmbed(`:white_check_mark:  Thanks for answering the questions!`, "We will get back to you as soon as possible.");
            message.channel.send({content: `<@&${process.env.ADMIN_ROLE_ID}>`, embeds: [embed]});
        }
    }

    /**
     * Delete the last message sent by the bot in the channel
     * @param {Ticket} ticket
     * @param {TextChannel} channel
     * @returns {Promise<void>}
     */
    async deleteLastMessage(ticket, channel) {
        if (ticket.last_discord_message == null) return;

        try {
            const previousMsg = await channel.messages.fetch(ticket.last_discord_message).catch(console.error);
            if (previousMsg?.deletable) previousMsg?.delete().catch(console.error);
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * Send a summary of the ticket to the channel
     * @param {TextChannel} channel
     * @returns {Promise<void>}
     */
    async sendSummary(channel) {
        let ticket = await this.ticketRepository.fetchTicketByChannelId(channel.id);
        if (!ticket) return;

        const embed = this.getEmbed('Project Summary', "Here is a summary of the information that you entered about this project.");
        embed.addFields(
            {name: "Project Name", value: ticket.name ?? ":no_entry_sign:  No project name entered", inline: true},
            {name: "Deadline", value: ticket.deadline ?? ":infinity: I have no deadline", inline: true},
            {name: "Project Description", value: ticket.description ?? ":no_entry_sign:  No project description entered", inline: false}
        );
        embed.setFooter({text: 'If you have any additional information, please use this channel to communicate with us.'});

        const sent = await channel.send({embeds: [embed]});
        sent?.pin().catch(console.error);
    }

    /**
     * Handles the deadline setting
     * @param {ButtonInteraction|Message} interaction The interaction
     * @param value
     * @returns {Promise<void>}
     */
    async handleDeadlineSetting(interaction, value) {
        const ticket = await this.ticketRepository.fetchTicketByChannelId(interaction.channel.id);
        if (ticket == null) return;

        if (value != null && value.length > 256) {
            await this.replyEmbedWithAutoDelete(interaction, "Deadline is too long", "The deadline that you entered is too long. Please enter a deadline that is less than 256 characters.", "#f54257");
            return;
        }

        ticket.deadline = value;
        ticket.setup_status = SetupStatus.EnterProjectDescription;

        const embed = this.getEmbed('Please describe your project in as much detail as possible.', null);

        this.deleteLastMessage(ticket, interaction.channel).catch(console.error);

        const sent = await interaction.channel.send({embeds: [embed]});
        ticket.last_discord_message = sent.id;

        await this.ticketRepository.updateTicket(ticket);
    }

    async openTicket(interaction) {
        const guild = interaction.guild;
        try {
            if (await this.ticketRepository.hasUserOpenTicket(interaction.user.id)) {
                await this.replyEmbedWithAutoDelete(interaction,
                    "You already have an open ticket",
                    "You already have an open ticket. Please close it before opening a new one.",
                    "#f54257");
                return;
            }

            const createdTicket = await this.ticketRepository.createTicket(
                new Ticket(interaction.user.id)
            );

            const createdChannel = await guild.channels.create({
                name: `ticket-${createdTicket.id}`,
                type: ChannelType.GuildText,
                parent: this.categoryId,
                topic: `Custom project ticket for ${interaction.user.username}.`
            });
            await createdChannel.permissionOverwrites.edit(guild.roles.everyone, {
                'ViewChannel': false,
                'SendMessages': false,
                'ReadMessageHistory': false
            });

            createdTicket.discord_channel_id = createdChannel.id;
            await this.ticketRepository.updateTicket(createdTicket);

            await this.giveUserPermission(createdChannel, interaction.user);

            await this.replyEmbedWithAutoDelete(interaction, "Ticket created!", `Ticket with channel <#${createdChannel.id}> has been created!`, "#46d846", true, false);
            this.sendFirstTicketMessage(await createdChannel.fetch(true).catch(console.error), interaction.user).catch(console.error);
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

    async createPricingLink(ticket) {
        // create new UUID
        try {
            const pricing = await this.projectPricingRepository.createProjectPricing(ticket);
            if (pricing) return `${process.env.WEBSITE_URL}/pricing?id=${encodeURIComponent(pricing.id)}&token=${encodeURIComponent(pricing.token)}&ticket_id=${pricing.ticket}`;
        } catch (e) {
            console.error(e);
        }
        return null;
    }

    async handlePricingUpdate(pricingId, ticketId, body) {
        const ticket = await this.ticketRepository.fetchTicketById(body.ticket_id);
        if (!ticket) return;

        const channel = await this.client.channels.fetch(ticket.discord_channel_id).catch(console.error);
        if (!channel) return;

        const pricingMessage = await channel.messages.fetch(ticket.last_discord_message).catch(console.error);
        if (pricingMessage && pricingMessage?.deletable) pricingMessage.delete().catch(console.error);

        const pricingEmbed = this.getEmbed("Pricing Summary", "Here is a summary of the pricing options that you selected for this project.");
        const typeRate = PluginRates.type[body.type].rate;
        pricingEmbed.addFields({
            name: "Project type",
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

        const embed = this.getEmbed("What is the name of your project?", null);
        const sentMsg = await channel.send({embeds: [embed]});

        sentMsg.pin().catch(console.error);

        console.log('Updating ticket status to EnterName');
        ticket.setup_status = SetupStatus.EnterName;
        ticket.last_discord_message = sentMsg.id;
        await this.ticketRepository.updateTicket(ticket);
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
        const ticket = await this.ticketRepository.fetchTicketByChannelId(channel.id);

        const embed = this.getEmbed(
            "Welcome to your custom project ticket!",
            `Hello <@${user.id}>,\n\n` +
            `Welcome to your custom project ticket with id #${ticket.id}!\n` +
            "We will be asking you a couple of questions regarding your request.\n\n" +
            "***Please note that you __cannot__ send messages in this channel until you have completed the setup process.***"
        );

        await channel.send({content: `<@${user.id}>`, embeds: [embed]});

        const firstMsg = this.getEmbed(
            "Pricing",
            "We have created a custom link for this ticket so you can easily select your pricing budgets per category. " +
            "Please select your pricing on the given link and click 'Submit' at the bottom of the page when you are done.\n\n" +
            await this.createPricingLink(ticket)
        );

        const sent = await channel.send({embeds: [firstMsg]});
        ticket.last_discord_message = sent.id;
        await this.ticketRepository.updateTicket(ticket);
    }

    async sendFirstMessage() {
        const channel = await this.client.channels.fetch(this.orderFromUsChannelId).catch(console.error);

        const pinnedMessages = await channel.messages.fetchPinned(false).catch(console.error);
        if (pinnedMessages.size !== 0) return;

        const embed = this.getEmbed(
            "Open a custom project ticket!",
            "**Do you have a project in mind but need talented developers to bring it to life?**\n\n" +
            "Click the button below to open a ticket and answer a few questions to get started. " +
            "Our team is dedicated to delivering high-quality solutions and we're here to help bring your vision to life.\n\n" +
            "Let's work together to make your project a reality!\n\n" +
            "*Click the button to start chatting with us!*"
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