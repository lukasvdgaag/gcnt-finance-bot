const Discord = require("discord.js");
const dotenv = require("dotenv");
const {MessageEmbed, MessageButton, MessageActionRow} = require("discord.js");
const mysql = require('mysql');

const Status = {
    BUDGETING: 'BUDGETING',
    ENTER_SERVER_NAME: 'ENTER_SERVER_NAME',
    ENTER_DEADLINE: 'ENTER_DEADLINE',
    ENTER_PROJECT_DESCRIPTION: 'ENTER_PLUGIN_DESCRIPTION',
    SUBMITTED: 'SUBMITTED',
}

const rates = {
    descriptions: {
        budget: '**:green_circle: Budget**',
        premium: '**:blue_circle: Premium**',
        pro: '**:purple_circle: Pro**',
    },
    type: {
        budget: {
            rate: 12,
            description: 'Utility plugin'
        },
        premium: {
            rate: 14,
            description: 'Game plugin __without__ BungeeCord support'
        },
        pro: {
            rate: 16,
            description: 'Game plugin __with__ BungeeCord support'
        }
    },
    testing: {
        budget: {
            rate: 0,
            description: 'Rapid test, one environment'
        },
        premium: {
            rate: 5,
            description: 'System tests after adding features, 2-4 environments'
        },
        pro: {
            rate: 10,
            description: 'Smoke tests after adding features, as many environments as possible with as many possible (config) setups'
        }
    },
    messages: {
        budget: {
            rate: 0,
            description: 'Hardcoded messages & items'
        },
        premium: {
            rate: 5,
            description: 'Customizable messages, hardcoded items'
        },
        pro: {
            rate: 10,
            description: 'Customizable messages & items'
        }
    },
    commands: {
        budget: {
            rate: 0,
            description: 'Regular commands to execute tasks'
        },
        premium: {
            rate: 2.50,
            description: 'Commands with auto-completion'
        },
        pro: {
            rate: 5,
            description: 'Commands to change config options'
        }
    },
    versions: {
        budget: {
            rate: 0,
            description: 'Written for one specific version'
        },
        premium: {
            rate: 4,
            description: 'Ability to run on 1.12- and 1.13+ with one NMS version when required'
        },
        pro: {
            rate: 15,
            description: 'Ability to run on max 4 flagship versions, with full NMS support'
        }
    },
    allow_publication: {
        rate: -15,
        description: '*In exchange for a 15 EUR discount, I hereby authorize GCNT to publish this plugin as a premium resource ' +
            'one month after the first version was made available to me. This only applies to resources that meet our premium requirements.*'
    },
}

class CustomPlugins {
    client = new Discord.Client({intents: ["GUILDS", "GUILD_MESSAGES", "GUILD_MEMBERS", "GUILD_MESSAGE_REACTIONS"]}); //create new client
    orderFromUsChannelId = '965377410335924295';
    guildId = '536178805828485140';
    categoryId = '965377119423197184';
    ticketInfo = new Map();

    constructor() {
        dotenv.config({path: __dirname + '/.env'});

        this.client.on('ready', () => {
            console.log(`Logged in as ${this.client.user.tag}!`);
            this.sendFirstMessage();
            this.createCommands();
        });
        this.client.on('messageCreate', (message) => {
            this.handleChatMessage(message);
        });
        this.client.on('interactionCreate', (interaction) => {
            if (interaction.channelId === this.orderFromUsChannelId && interaction.type === 'MESSAGE_COMPONENT') {
                if (interaction.customId === 'open-ticket') {
                    this.openTicket(interaction);
                }
            } else if (interaction.customId === "no-deadline") {
                this.handleDeadlineSetting(interaction.channel, null);
            } else if (interaction.type === "APPLICATION_COMMAND") {
                this.handleCommand(interaction);
            }
        });

        this.client.login(process.env.CLIENT_TOKEN_CUSTOM_PLUGINS); //login bot using token
    }

    getCachedTicketFromChannel(channelId) {
        for (let [key, value] of this.ticketInfo) {
            if (value.channelId === channelId) {
                return value;
            }
        }
    }

    async handleCommand(interaction) {
        if (interaction.commandName !== "order") return;

        const subcommand = interaction.options.getSubcommand(false);
        switch (subcommand) {
            case "open":
                this.openTicket(interaction);
                break;
            case "close":
                if (!await this.checkForChannelId(interaction)) break;
                this.closeTicket(interaction, interaction.options.getBoolean("approve", false) ?? null);
                break;
            case "adduser":
                if (!await this.checkForChannelId(interaction)) break;
                this.addUserToTicket(interaction, interaction.options.getUser("user", false) ?? null);
                break;
            case "removeuser":
                if (!await this.checkForChannelId(interaction)) break;
                this.removeUserFromTicket(interaction, interaction.options.getUser("user", false) ?? null);
                break;
        }
    }

    async addUserToTicket(interaction, user) {
        if (user == null) {
            const embed = this.getEmbed("User not found", "Please enter a valid user", "#f54257");
            const sent = await interaction.reply({embeds: [embed], fetchReply: true});
            setTimeout(() => sent.delete(), 5000);
            return;
        }

        if (interaction.user.id === user.id) {
            const embed = this.getEmbed("That's you!", "You can't add yourself to this ticket since you already have access.", "#f54257");
            const sent = await interaction.reply({embeds: [embed], fetchReply: true});
            setTimeout(() => sent.delete(), 5000);
            return;
        }

        const found = await interaction.channel.permissionOverwrites.cache.find(search => search.id === user.id);
        if (found != null) {
            const embed = this.getEmbed("User already has access", "That user already has access to this ticket.", "#f54257");
            const sent = await interaction.reply({embeds: [embed], fetchReply: true});
            setTimeout(() => sent.delete(), 5000);
            return;
        }

        this.giveUserPermission(interaction.channel, user);
        const embed = this.getEmbed("User added", `<@${user.id}> has been added to this ticket by <@${interaction.user.id}>.`, "#f58a42");

        const sent = await interaction.reply({"content": "User added!", fetchReply: true});
        setTimeout(() => sent.delete(), 5000);

        await interaction.channel.send({embeds: [embed]});
    }

    async removeUserFromTicket(interaction, user) {
        if (user == null) {
            const embed = this.getEmbed("User not found", "Please enter a valid user", "#f54257");
            const sent = await interaction.reply({embeds: [embed], fetchReply: true});
            setTimeout(() => sent.delete(), 5000);
            return;
        }

        if (interaction.user.id === user.id) {
            const embed = this.getEmbed("That's you!", "You can't remove yourself from this ticket since you opened it. If you wish to close this ticket, please use `/order close`.", "#f54257");
            const sent = await interaction.reply({embeds: [embed], fetchReply: true});
            setTimeout(() => sent.delete(), 5000);
            return;
        }

        if (user.bot) {
            const embed = this.getEmbed("That's a bot!", "You can't remove bots from this ticket.", "#f54257");
            const sent = await interaction.reply({embeds: [embed], fetchReply: true});
            setTimeout(() => sent.delete(), 5000);
            return;
        }

        const member = await interaction.guild.members.fetch(user.id);
        if (member.roles.cache.some(role => role.id === '571717051727609857')) {
            const embed = this.getEmbed("That's a staff member!", "You can't remove staff members from this ticket.", "#f54257");
            const sent = await interaction.reply({embeds: [embed], fetchReply: true});
            setTimeout(() => sent.delete(), 5000);
            return;
        }

        const found = await interaction.channel.permissionOverwrites.cache.find(search => search.id === user.id);
        if (found == null) {
            const embed = this.getEmbed("User has no access", "That user does not have access to this ticket.", "#f54257");
            const sent = await interaction.reply({embeds: [embed], fetchReply: true});
            setTimeout(() => sent.delete(), 5000);
            return;
        }

        interaction.channel.permissionOverwrites.delete(user.id);

        const embed = this.getEmbed("User removed", `<@${user.id}> has been removed from this ticket by <@${interaction.user.id}>.`, "#f58a42");

        const sent = await interaction.reply({"content": "User removed!", fetchReply: true});
        setTimeout(() => sent.delete(), 5000);

        await interaction.channel.send({embeds: [embed]});
    }

    async checkForChannelId(interaction) {
        if (interaction.channelId == null) {
            const embed = this.getEmbed("Please execute this command in a channel!", "This command has to be executed in a ticket channel.", "#f54257");
            const sent = await interaction.reply({embeds: [embed], fetchReply: true});
            setTimeout(() => sent.delete(), 5000);
            return false;
        }

        const userRes = await this.executeSQL("SELECT id, role FROM users WHERE discord_id = ?", [interaction.user.id]);
        if (userRes == null || userRes.length === 0 || (userRes[0].id ?? null) == null) {
            const embed = this.getEmbed("No permission!", "You are not allowed to execute this action on this ticket.", "#f54257");
            const sent = await interaction.reply({embeds: [embed], fetchReply: true});
            setTimeout(() => sent.delete(), 5000);
            return false;
        }

        const found = await this.executeSQL("SELECT * FROM plugin_request_ticket WHERE discord_channel_id = ?", interaction.channelId);
        if (found == null || found.length === 0) {
            const embed = this.getEmbed("No ticket found!", "There is no ticket associated with the channel that you are executing this command from. " +
                "Please execute this command from the channel that is linked to the ticket that you're trying to execute an action on.", "#f54257");
            const sent = await interaction.reply({embeds: [embed], fetchReply: true});
            setTimeout(() => sent.delete(), 8000);
            return false;
        }

        if (userRes[0].role !== "admin" && found[0].requester !== userRes[0].id) {
            const embed = this.getEmbed("No permission!", "You are not allowed to execute this action on this ticket.", "#f54257");
            const sent = await interaction.reply({embeds: [embed], fetchReply: true});
            setTimeout(() => sent.delete(), 5000);
            return false;
        }

        return true;
    }

    async revokeAccess(channel) {
        channel.permissionOverwrites.cache.forEach( (value, user) => {
            if (value.type === "member") {
                channel.permissionOverwrites.edit(user, {
                    ADD_REACTIONS: true,
                    ATTACH_FILES: true,
                    READ_MESSAGE_HISTORY: true,
                    SEND_MESSAGES: false,
                    VIEW_CHANNEL: true
                });
            }
        });
    }

    async closeTicket(interaction, approve = null) {
        const userRes = await this.executeSQL("SELECT id, role FROM users WHERE discord_id = ?", [interaction.user.id]);

        if (userRes[0].role !== "admin" || approve == null) {
            const embed = this.getEmbed("Ticket closed!", `<@${interaction.user.id}> has closed the ticket.`, "#f58a42");
            const sent = await interaction.reply({content: "Ticket closed!", fetchReply: true});
            setTimeout(() => sent.delete(), 5000);

            this.revokeAccess(interaction.channel);
            await this.executeSQL("UPDATE plugin_request_ticket SET status = ? WHERE discord_channel_id = ?", ['CLOSED', interaction.channelId]);
            interaction.channel.send({embeds: [embed]});
            return;
        }

        let embed;
        if (approve) embed = this.getEmbed("Ticket approved!", `<@${interaction.user.id}> has approved the ticket.`, "#42f566");
        else embed = this.getEmbed("Ticket denied!", `<@${interaction.user.id}> has denied the ticket.`, "#f54257");

        this.revokeAccess(interaction.channel);
        await this.executeSQL("UPDATE plugin_request_ticket SET status = ? WHERE discord_channel_id = ?", [approve ? "APPROVED" : "DENIED", interaction.channelId]);

        const sent = await interaction.reply({content: `Ticket ${approve ? "approved" : "denied"}!`, fetchReply: true});
        setTimeout(() => sent.delete(), 5000);
        interaction.channel.send({embeds: [embed]});
    }

    async createCommands() {
        try {
            const cmds = {
                name: 'order',
                description: 'Create a new ticket for ordering a custom plugin.',
                options: [
                    {
                        type: 'SUB_COMMAND',
                        name: 'open',
                        description: 'Open a new custom plugin ordering ticket.',
                    },
                    {
                        type: 'SUB_COMMAND',
                        name: 'close',
                        description: 'Close the current custom plugin ordering ticket.',
                        options: [
                            {
                                type: 'BOOLEAN',
                                name: 'approve',
                                description: 'Whether to approve the request (Admins) .',
                                required: false,
                            }
                        ]
                    },
                    {
                        type: 'SUB_COMMAND',
                        name: 'adduser',
                        description: 'Add another user to the current custom plugin ordering ticket.',
                        options: [
                            {
                                type: 'USER',
                                name: 'user',
                                description: 'The user to add to the ticket.',
                                required: true,
                            }
                        ]
                    },
                    {
                        type: 'SUB_COMMAND',
                        name: 'removeuser',
                        description: 'Remove a user from the current custom plugin ordering ticket.',
                        options: [
                            {
                                type: 'USER',
                                name: 'user',
                                description: 'The user to remove from the ticket.',
                                required: true,
                            }
                        ]
                    },
                ]
            };

            // const guild = await this.client.guilds.fetch(this.guildId);
            // guild.commands.create(cmds);

            this.client.application.commands.create(cmds);
        } catch (e) {
            console.log(e);
        }
    }

    async giveUserPermission(channel, user) {
        await channel.permissionOverwrites.create(user, {
            ADD_REACTIONS: true,
            ATTACH_FILES: true,
            READ_MESSAGE_HISTORY: true,
            SEND_MESSAGES: true,
            VIEW_CHANNEL: true
        }, {type: 1, reason: 'Give user permission to access channel'});
    }

    async handleChatMessage(message) {
        if ((message.channel.parentId === this.categoryId && message.type === "CHANNEL_PINNED_MESSAGE") ||
            (message.channel.id === this.orderFromUsChannelId && !message.author.bot)) {
            message.delete();
            return;
        }
        if (message.author.bot) return;

        if (message.channel.parentId !== this.categoryId) {
            return;
        }

        const ticketInfo = this.getCachedTicketFromChannel(message.channel.id);
        if (ticketInfo == null || ticketInfo.status === Status.SUBMITTED) {
            return;
        }

        if (ticketInfo.status === Status.BUDGETING) {
            message.delete();
            return;
        }

        if (ticketInfo.status === Status.ENTER_SERVER_NAME) {
            message.delete();
            if (message.content.length > 35) {
                const embed = this.getEmbed("Server name too long", "The server name that you entered is too long. Please enter a server name with less than 35 characters", "#f54257");
                const sent = await message.channel.send({embeds: [embed]});
                setTimeout(() => {
                    sent.delete();
                }, 5000);
                return;
            }

            ticketInfo.serverName = message.content;
            ticketInfo.status = Status.ENTER_DEADLINE;
            this.setTicketSQLValue(ticketInfo.ticketId, 'server_name', message.content);

            const embed = this.getEmbed(`When is the deadline for this product?`, null);
            const interactions = new MessageActionRow().addComponents(
                new MessageButton()
                    .setCustomId('no-deadline')
                    .setStyle('PRIMARY')
                    .setLabel('I have no deadline')
                    .setEmoji('♾️')
            );

            const previousMsg = await message.channel.messages.fetch(ticketInfo.serverMessage);
            if (previousMsg != null) previousMsg.delete();

            delete ticketInfo.serverMessage;

            const sent = await message.channel.send({embeds: [embed], components: [interactions]});
            ticketInfo.deadlineMessage = sent.id;
        } else if (ticketInfo.status === Status.ENTER_DEADLINE) {
            message.delete();
            this.handleDeadlineSetting(message.channel, message.content);
        } else if (ticketInfo.status === Status.ENTER_PROJECT_DESCRIPTION) {
            message.delete();

            ticketInfo.description = message.content;
            ticketInfo.status = Status.SUBMITTED;
            this.setTicketSQLValue(ticketInfo.ticketId, 'plugin_description', message.content);

            await this.sendSummary(message.channel, ticketInfo.ticketId);

            const embed = this.getEmbed(`:white_check_mark:  Thanks for answering the questions!`, "We will get back to you as soon as possible.");

            const previousMsg = await message.channel.messages.fetch(ticketInfo.descriptionMessage);
            if (previousMsg != null) previousMsg.delete();

            delete ticketInfo.descriptionMessage;

            message.channel.send({content: '<@&571717051727609857>', embeds: [embed]});
        }
    }

    async sendSummary(channel, ticketId) {
        let ticketInfo = await this.executeSQL(`SELECT *
                                                FROM plugin_request_ticket
                                                WHERE id = ?`, [ticketId]);
        if (ticketInfo == null || ticketInfo[0] == null) return;
        ticketInfo = ticketInfo[0];

        const embed = this.getEmbed(`Project Summary`, "Here is a summary of the information that you entered about this project.");
        embed.addField("Server Name", ticketInfo.server_name ?? ":no_entry_sign:  No server name entered", true);
        embed.addField("Deadline", ticketInfo.deadline ?? ":infinity: I have no deadline", true);
        embed.addField("ProjectDescription", ticketInfo.plugin_description ?? ":no_entry_sign:  No project description entered", true);
        embed.setFooter({text: 'If you have any additional information, please use this channel to communicate with us.'});

        const sent = await channel.send({embeds: [embed]});
        sent.pin();
    }

    async handleDeadlineSetting(channel, value) {
        const ticketInfo = this.getCachedTicketFromChannel(channel.id);
        if (ticketInfo == null) return;

        if (value != null && value.length > 256) {
            const embed = this.getEmbed("Deadline is too long", "The deadline that you entered is too long. Please enter a deadline that is less than 256 characters.");
            const sent = await channel.send({embeds: [embed]});
            setTimeout(() => {
                sent.delete();
            }, 5000);
            return;
        }

        ticketInfo.deadline = value;
        ticketInfo.status = Status.ENTER_PROJECT_DESCRIPTION;
        if (value != null) this.setTicketSQLValue(ticketInfo.ticketId, 'deadline', value);

        const embed = this.getEmbed(`Please describe your project in as much detail as possible.`, null);

        const previousMsg = await channel.messages.fetch(ticketInfo.deadlineMessage);
        if (previousMsg != null) previousMsg.delete();

        delete ticketInfo.deadlineMessage;

        const sent = await channel.send({embeds: [embed]});
        ticketInfo.descriptionMessage = sent.id;
    }

    setTicketSQLValue(ticketId, key, value) {
        const clas = this;
        return new Promise(async function (ok, fail) {
            const con = clas.#getConnection();
            con.connect(function (err) {
                if (err) {
                    fail(err);
                    return;
                }
                con.query(`UPDATE plugin_request_ticket
                           SET ${key} = ?
                           WHERE id = ?`, [value, ticketId],
                    function (err, result, fields) {
                        if (err) {
                            fail(err);
                            return;
                        }
                        ok(result ?? null);
                    });
            });
        });
    }

    #getConnection() {
        return mysql.createConnection({
            host: process.env.MYSQL_HOST,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASS,
            database: 'gaagjescraft'
        });
    }

    async openTicket(interaction) {
        const guild = interaction.guild;
        try {
            const id = interaction.user.id;
            console.log(id);
            const userRes = await this.executeSQL("SELECT id FROM users WHERE discord_id = ? AND discord_verified = 1", [id]);
            console.log(userRes);
            if (userRes == null || userRes.length === 0 || (userRes[0].id ?? null) == null) {
                const embed = this.getEmbed("No (verified) MyGCNT account found!", "We couldn't find a (verified) MyGCNT account that is linked to this Discord. Please create an account if you do not have one yet with the link below and make sure to verify it in <#645068503275143169> with `/verify mygcnt`.\n https://my.gcnt.net/register ", "#f54257");
                const sent = await interaction.reply({embeds: [embed], fetchReply: true});
                setTimeout(() => {
                    sent.delete();
                }, 5000);
                return;
            }

            const res = await this.executeSQL("SELECT COUNT(*) AS amount FROM plugin_request_ticket WHERE requester = ? AND status = 'OPEN'", [userRes[0].id]);
            if (res == null || (res[0].amount ?? 0) > 0) {
                const embed = this.getEmbed("You already have an open ticket", "You already have an open ticket. Please close it before opening a new one.", "#f54257");
                const sent = await interaction.reply({embeds: [embed], fetchReply: true});
                setTimeout(() => {
                    sent.delete();
                }, 5000);
                return;
            }

            const number = (Math.random() * 100).toString();
            const created = await guild.channels.create("ticket-" + number, {
                type: "GUILD_TEXT",
                parent: this.categoryId,
                topic: `Custom plugin ticket for ${interaction.user.username}.`
            });
            await this.giveUserPermission(created, interaction.user);

            const reply = await interaction.reply({content: `Ticket with channel <#${created.id}> has been created!`, fetchReply: true});
            setTimeout(() => {
                reply.delete();
            }, 5000);
            this.sendFirstTicketMessage(await created.fetch(true), interaction.user, userRes[0].id);
        } catch (e) {
            console.error(e);
            interaction.channel.send("Something went wrong. Please try again later.");
        }
    }

    async executeSQL(query, values) {
        const clas = this;
        return new Promise(async function (ok, fail) {
            const con = clas.#getConnection();
            con.connect(function (err) {
                if (err) {
                    fail(err);
                    return;
                }
                con.query(query, values,
                    function (err, result, fields) {
                        if (err) {
                            fail(err);
                            return;
                        }
                        ok(result ?? null);
                    });
            });
        });
    }

    async createTicket(channel, gcntId) {
        return this.executeSQL(`INSERT INTO plugin_request_ticket (requester, discord_channel_id)
                                VALUES (?, ?)`, [gcntId, channel.id]);
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
            if (pricing != null) return `https://www.gcnt.net/new-pricing?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}&ticket_id=${ticket}`;
        } catch (e) {
            console.error(e);
        }
        return null;
    }

    async handlePricingUpdate(pricingId, ticketId, body) {
        const currentTicketInfo = this.ticketInfo.get(body.ticket_id);
        if (currentTicketInfo == null) {
            console.log("Ticket not found");
            return;
        }

        const channel = await this.client.channels.fetch(currentTicketInfo.channelId);
        if (channel == null) {
            console.log("Channel not found");
            return;
        }

        const pricingMessage = await channel.messages.fetch(currentTicketInfo.pricingLinkMessage)
        if (pricingMessage != null) pricingMessage.delete();

        const pricingEmbed = this.getEmbed("Pricing Summary", "Here is a summary of the pricing options that you selected for this project.");
        const typeRate = rates.type[body.type].rate;
        pricingEmbed.addField("Plugin type", `${rates.descriptions[body.type]} - ${typeRate} EUR / hour\n${rates.type[body.type].description}`, true);
        const testingRate = rates.testing[body.testing].rate;
        pricingEmbed.addField("Testing", `${rates.descriptions[body.testing]} - ${testingRate} EUR\n${rates.testing[body.testing].description}`, true);
        const messagesRate = rates.messages[body.messages].rate;
        pricingEmbed.addField("Messages & Items", `${rates.descriptions[body.messages]} - ${messagesRate} EUR\n${rates.messages[body.messages].description}`, true);
        const commandsRate = rates.commands[body.commands].rate;
        pricingEmbed.addField("Commands", `${rates.descriptions[body.commands]} - ${commandsRate} EUR\n${rates.commands[body.commands].description}`, true);
        const versionsRate = rates.versions[body.versions].rate;
        pricingEmbed.addField("Versions", `${rates.descriptions[body.versions]} - ${versionsRate} EUR\n${rates.versions[body.versions].description}`, true);
        if (body.allow_publication) {
            pricingEmbed.addField("Publication", `${rates.allow_publication.rate} EUR\n${rates.allow_publication.description}`, false);
        }

        let total = testingRate + messagesRate + commandsRate + versionsRate + (body.allow_publication ? rates.allow_publication.rate : 0);
        if (body.type == 'premium' && body.testing == "premium") total -= testingRate;
        else if (body.type == 'pro' && body.testing == "pro") total -= testingRate;

        const totalMsg = total === 0 ? "" : (total > 0 ? `+ ${total} EUR` : `- ${(total * -1)} EUR`)

        pricingEmbed.addField("Total", `${typeRate} EUR / hour ${totalMsg}`, false);
        pricingEmbed.setFooter({text: 'This pricing is final and cannot be changed.'});

        channel.send({embeds: [pricingEmbed]});

        const embed = this.getEmbed("What is the name of your server?", null);
        const sentMsg = await channel.send({embeds: [embed]});

        sentMsg.pin();

        currentTicketInfo.pricing = body;
        currentTicketInfo.status = Status.ENTER_SERVER_NAME;
        currentTicketInfo.serverMessage = sentMsg.id;
    }

    getEmbed(title, description = null, color = process.env.COLOR) {
        const embed = new MessageEmbed()
            .setTitle(title)
            .setColor(color);
        if (description != null) embed.setDescription(description);
        return embed;
    }

    async sendFirstTicketMessage(channel, user, gcntId) {
        const ticketRes = await this.createTicket(channel, gcntId);

        const ticket = ticketRes.insertId;
        channel.setName(`ticket-${ticket}`);

        const currentTicketInfo = {
            ticketId: ticket,
            channelId: channel.id,
            userId: user.id,
            status: Status.BUDGETING,
            gcntId: gcntId
        };
        this.ticketInfo.set(ticket.toString(), currentTicketInfo);

        const embed = new MessageEmbed()
            .setTitle("Welcome to your custom plugin ticket!")
            .setDescription(`Hello <@${user.id}>,\n\nWelcome to your custom plugin ticket with id #${ticket}!\nWe will be asking you a couple of questions regarding your request.`)
            .setColor(process.env.COLOR);

        const firstSent = channel.send({content: `<@${user.id}>`, embeds: [embed]});
        currentTicketInfo.initialMessage = firstSent.id;


        const firstMsg = new MessageEmbed()
            .setTitle("Pricing")
            .setDescription("We have created a custom link for this ticket so you can easily select your pricing budgets per category. " +
                "Please select your pricing on the given link and click 'Submit' at the bottom of the page when you are done.\n\n" +
                await this.createPricingLink(ticket))
            .setColor(process.env.COLOR);

        const sent = await channel.send({embeds: [firstMsg]});
        currentTicketInfo.pricingLinkMessage = sent.id;
    }

    async sendFirstMessage() {
        const channel = await this.client.channels.fetch(this.orderFromUsChannelId);

        const pinnedMessages = await channel.messages.fetchPinned(false);
        if (pinnedMessages.size !== 0) return;

        const embed = new MessageEmbed()
            .setColor(process.env.COLOR)
            .setTitle("Let's make your Minecraft dream come true!")
            .setDescription("**Click the button below to get started!**\nWe will create you a personal ticket channel that we will use to discuss the project with you.");

        const actionRow = new MessageActionRow()
            .addComponents(
                new MessageButton()
                    .setEmoji('🎟️')
                    .setLabel('Open a ticket!')
                    .setStyle('PRIMARY')
                    .setCustomId('open-ticket')
            );

        const sent = await channel.send({embeds: [embed], components: [actionRow]});
        sent.pin();

    }

}


module
    .exports = CustomPlugins;