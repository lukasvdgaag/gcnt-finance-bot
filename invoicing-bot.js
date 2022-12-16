// import Discord, {MessageActionRow, MessageAttachment, MessageButton, MessageEmbed, MessageSelectMenu} from 'discord.js';
const {createDraft, getAccessToken, getItemField, getPayPalUserInfo, getQRCode, getTotal, round, sendInvoice, sendRequest} = require("./paypal.js");
const PaymentMessenger = require('./payment_messenger.js');
const {
    ActionRowBuilder,
    AttachmentBuilder,
    BaseInteraction,
    ButtonBuilder,
    ButtonInteraction,
    Client,
    CommandInteraction,
    EmbedBuilder,
    Message,
    TextChannel,
    UserSelectMenuBuilder,
    UserSelectMenuInteraction,
    GatewayIntentBits
} = require("discord.js");

const InvoiceActionType = {
    CUSTOMER: "CUSTOMER",
    ADD_ITEMS: "ADD_ITEMS",
    ENTER_NAME: "ENTER_NAME",
    ENTER_DESCRIPTION: "ENTER_DESCRIPTION",
    ENTER_MEASURE_UNIT: "ENTER_MEASURE_UNIT",
    ENTER_RATE: "ENTER_RATE",
    ENTER_QUANTITY: "ENTER_QUANTITY",
    REVIEW_ITEM: "REVIEW_ITEM"
}

class InvoicingBot {

    botLogo = "https://www.gcnt.net/inc/img/discord-finance-bot-logo.png";
    client;
    paymentMessenger;
    userProgress;

    constructor() {
        this.userProgress = new Map();

        this.client = new Client({intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessageReactions]});

        this.client.on('ready', () => {
            this.handleApplicationReady()
        });
        this.client.on('messageCreate', async (message) => {
            this.handleMessageCreation(message).catch()
        });
        this.client.on('interactionCreate', (interaction) => {
            this.handleInteraction(interaction).catch();
        });

        this.client.login(process.env.CLIENT_TOKEN).catch();
    }

    handleApplicationReady() {
        console.log(`Logged in as ${this.client.user.tag}!`);
        this.paymentMessenger = new PaymentMessenger(this.client);

        getAccessToken().catch();
        this.createCommands();
    }

    /**
     * @param {Message} msg
     * @returns {Promise<void>}
     */
    async handleMessageCreation(msg) {
        this.paymentMessenger.processMessage(msg);

        if (!msg.author.bot) return;

        const userProg = this.userProgress.get(msg.author.id);
        const userSub = userProg?.subject;
        const items = userProg?.items;
        const lastItem = items != null && items.length !== 0 ? items[items.length - 1] : null;

        if (userProg?.last_error_msg != null) {
            try {
                userProg.last_error_msg.delete();
                delete userProg.last_error_msg;
            } catch (error) {
            }
        }

        if (userProg != null && msg.content === "cancel") {
            msg.delete().then();
            if (userProg.last_item_message != null) userProg.last_item_message.delete();
            if (userProg.new_message != null) userProg.new_message.delete();
            this.userProgress.delete(msg.author.id);
            const error = await this.sendErrorMessage(msg.channel, "Invoice cancelled!", "Your current PayPal Invoice Setup has been discarded.");
            setTimeout(() => error.delete(), 8000);
            return;
        }

        if (userSub === InvoiceActionType.ENTER_NAME && lastItem != null) {
            this.handleNameInputInteraction(msg, userProg, lastItem);
        } else if (userSub === InvoiceActionType.ENTER_DESCRIPTION && lastItem != null) {
            this.handleDescriptionInputInteraction(msg, userProg, lastItem);
        }
    }

    /**
     * @param {Message} msg
     * @param userProg
     * @param lastItem
     */
    handleNameInputInteraction(msg, userProg, lastItem) {
        msg.delete().catch();
        lastItem.name = msg.content;
        userProg.subject = InvoiceActionType.ENTER_DESCRIPTION;
        this.sendNewItemMessage(msg.channel, userProg);
    }

    /**
     * @param {Message} msg
     * @param userProg
     * @param lastItem
     */
    handleDescriptionInputInteraction(msg, userProg, lastItem) {
        msg.delete().catch();
        lastItem.description = msg.content;
        userProg.subject = InvoiceActionType.ENTER_MEASURE_UNIT;
        this.sendNewItemMessage(msg.channel, userProg);
    }

    /**
     * @param {Message} msg
     * @param userProg
     * @param lastItem
     */
    handleRateInputInteraction(msg, userProg, lastItem) {
        msg.delete().catch();
        if (Number.isNaN(msg.content)) {
            this.sendErrorMessage(msg.channel, "Rate not a number!", "The amount you entered is not a valid number.")
                .then(r => userProg.last_error_msg = r);
        } else if (Number.parseFloat(msg.content) < 0) {
            this.sendErrorMessage(msg.channel, "Rate too low!", "The number you entered must be 0 or greater.")
                .then(r => userProg.last_error_msg = r);
        } else {
            lastItem.rate = Number.parseFloat(msg.content);
            userProg.subject = lastItem.measure_unit === "HOURS" ? InvoiceActionType.ENTER_QUANTITY : InvoiceActionType.REVIEW_ITEM;
            this.sendNewItemMessage(msg.channel, userProg);
        }
    }

    /**
     * @param {Message} msg
     * @param userProg
     * @param lastItem
     */
    handleQuantityInputInteraction(msg, userProg, lastItem) {
        msg.delete().catch();
        if (Number.isNaN(msg.content)) {
            this.sendErrorMessage(msg.channel, "Quantity not a number!", "The amount you entered is not a valid number.").then(r => userProg.last_error_msg = r);
        } else if (Number.parseFloat(msg.content) < 0) {
            this.sendErrorMessage(msg.channel, "Quantity too low!", "The number you entered must be 0 or greater.").then(r => userProg.last_error_msg = r);
        } else {
            lastItem.quantity = Number.parseFloat(msg.content);
            userProg.subject = InvoiceActionType.REVIEW_ITEM;
            this.sendNewItemMessage(msg.channel, userProg);
        }
    }

    /**
     *
     * @param {UserSelectMenuInteraction} interaction
     * @param userProg
     */
    async handleCustomerSelectInteraction(interaction, userProg) {
        userProg.customer_info = await getPayPalUserInfo(interaction.users[0]?.id);
        if (userProg.customer_info == null) {
            this.sendErrorMessage(interaction.channel, "No MyGCNT User Found!", "We failed to find a MyGCNT account connect to the selected user or their account is not discord-verified. Please make sure this the user is linked to a verified MyGCNT account.")
                .then(r => userProg.last_error_msg = r);
            return;
        }

        userProg.interaction.deleteReply().then();
        delete userProg.interaction;
        userProg.subject = "";
        userProg.customer = member;

        sendRequest("https://api.paypal.com/v2/invoicing/generate-next-invoice-number")
            .then(responseText => {
                userProg.invoice_number = responseText.invoice_number;
                this.sendUpdateNewInvoiceMessage(interaction.channel, interaction.user.id, userProg);
            })
            .catch(err => console.error(err));
        userProg.subject = InvoiceActionType.ADD_ITEMS;
    }

    createCommands() {
        const cmds = {
            type: 1,
            name: "create-invoice",
            description: "Create a new GCNT PayPal Invoice",
            default_member_permissions: "0",
            dm_permission: false,
        }

        try {
            this.client.application.commands.create(cmds);
        } catch (e) {
            console.log(e);
        }
    }

    /**
     * @param {CommandInteraction} interaction
     */
    sendNewInvoiceMessage(interaction) {
        let embed;
        let row = new ActionRowBuilder();

        if (this.userProgress.get(interaction.user.id)?.subject != null) {
            embed = new MessageEmbed()
                .setColor(process.env.COLOR_RED)
                .setAuthor({name: ':warning: Are you sure? :warning:', iconURL: this.botLogo})
                .setDescription("You currently have an unfinished invoice setup. If you continue, your current draft will be discarded. Do you want to continue?");
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('cancel-new-invoice')
                    .setStyle('SECONDARY')
                    .setLabel('Cancel'),
                new ButtonBuilder()
                    .setCustomId('discard-invoice')
                    .setStyle('DANGER')
                    .setLabel('Discard draft')
            );
        } else {
            this.userProgress.set(interaction.user.id, {
                subject: InvoiceActionType.CUSTOMER,
                interaction: interaction,
                items: [],
                sending: false,
                sent: false,
                cancelling_item: false
            });

            embed = new EmbedBuilder()
                .setColor(process.env.COLOR)
                .setAuthor({name: 'Who is this invoice for?', iconURL: this.botLogo})
                .setDescription("Please select the user that this invoice is for using the dropdown below.");

            row.addComponents(new UserSelectMenuBuilder()
                .setCustomId('invoice-user-select')
                .setPlaceholder("Select a user")
                .setMaxValues(1));
        }

        interaction.reply({embeds: [embed], components: [row]}).catch();
    }

    /**
     * @param {TextChannel} channel
     * @param userProg
     */
    sendNewItemMessage(channel, userProg) {
        const items = userProg?.items;
        const lastItem = items != null && items.length !== 0 ? items[items.length - 1] : null;

        const embed = new MessageEmbed()
            .setColor(process.env.COLOR)
            .setTimestamp();

        let addBackButton = true;
        let description = "Enter the name of the item in the chat.";
        let title = "Enter the name.";
        let row = new ActionRowBuilder();
        if (lastItem != null) {
            addBackButton = false;
            if (lastItem.name != null) {
                addBackButton = true;

                if (lastItem.description == null) {
                    title = "Enter the description.";
                    description = "Enter the description of the item in the chat.";
                    embed.addField("Name", lastItem.name, false);
                } else if (lastItem.measure_unit == null) {
                    title = "Select the measure unit.";
                    description = "Click the measure unit you want to use for this invoice.";

                    embed.addFields(
                        {name: "Name", value: lastItem.name},
                        {name: "Description", value: lastItem.description}
                    );

                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId('mu-HOURS')
                            .setStyle("PRIMARY")
                            .setLabel("Hours")
                            .setEmoji("⏱️"),
                        new ButtonBuilder()
                            .setCustomId("mu-AMOUNT")
                            .setStyle("PRIMARY")
                            .setLabel("Amount")
                            .setEmoji("💰")
                    );
                } else {
                    embed.addFields(
                        {name: "Name", value: lastItem.name},
                        {name: "Description", value: lastItem.description}
                    );

                    if (lastItem.measure_unit === "HOURS") {
                        embed.addFields({name: "Measure unit", value: "Hourly", inline: true});

                        if (lastItem.rate == null) {
                            title = "Enter the hourly rate.";
                            description = "Enter the amount of money that you want to charge per hour in the chat.";
                        } else if (lastItem.quantity == null) {
                            title = "Enter the number of hours.";
                            description = "Enter the amount of hours that you spent on this item in the chat.";
                            embed.addField("Hourly rate", lastItem.rate + " EUR", true);
                        } else {
                            // add everything
                            title = "Review";
                            description = "All information about the item you just created";
                            embed.addFields(
                                {name: "Hourly rate", value: lastItem.rate + " EUR", inline: true},
                                {name: "Hours spent", value: lastItem.quantity + "", inline: true},
                                {name: "Subtotal", value: round(lastItem.rate * lastItem.quantity) + " EUR"}
                            );

                        }
                    } else if (lastItem.measure_unit === "AMOUNT") {
                        embed.addFields({name: "Measure unit", value: "Fixed amount", inline: true});

                        if (lastItem.rate == null) {
                            title = "Enter the subtotal.";
                            description = "Enter the amount of money that you want to charge for this item in the chat.";
                        } else {
                            // add everything
                            title = "Review";
                            description = "All information about the item you just created";
                            embed.addFields({name: "Subtotal", value: lastItem.rate + " EUR", inline: true});
                        }
                    }

                    if (userProg.subject === "REVIEW_ITEM") {
                        row.addComponents(
                            new ButtonBuilder()
                                .setCustomId("submit-item")
                                .setStyle("SUCCESS")
                                .setLabel("Finish")
                        );
                    }
                }
            }
        }

        if (addBackButton) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId("item-go-back")
                    .setStyle("SECONDARY")
                    .setLabel("Go back")
            );
        }
        row.addComponents(
            new ButtonBuilder()
                .setCustomId("cancel-item")
                .setStyle("DANGER")
                .setLabel("Cancel item")
        );

        if (lastItem != null && userProg.cancelling_item) {
            title = "Cancel item?";
            description = "Select whether you want to go through with the cancellation of this item.";
            row.setComponents(
                new ButtonBuilder()
                    .setCustomId("confirm-cancel-item")
                    .setStyle("DANGER")
                    .setLabel("Cancel item"),
                new ButtonBuilder()
                    .setCustomId("cancel-cancel-item")
                    .setStyle("PRIMARY")
                    .setLabel("Continue item setup")
            )
        }

        embed.setAuthor({name: `[NEW ITEM] ${title}`, iconURL: this.botLogo});
        embed.setDescription(description);
        embed.setFooter({text: description});

        let msgObj = {embeds: [embed], components: []};
        if (row.components.length !== 0) {
            msgObj.components = [row];
        }

        if (userProg.last_item_message != null) {
            userProg.last_item_message.edit(msgObj).catch();
        } else {
            channel.send(msgObj).then(sent => userProg.last_item_message = sent);
        }
    }

    /**
     *
     * @param {TextChannel} channel
     * @param ownerId
     * @param userProg
     */
    async sendUpdateNewInvoiceMessage(channel, ownerId, userProg) {
        const embed = new EmbedBuilder()
            .setColor(process.env.COLOR)
            .setAuthor({name: 'Creating a new invoice', iconURL: this.botLogo})
            .setTimestamp()
            .setFooter({text: 'Type "cancel" to cancel this invoice.'});

        if (userProg.sending) embed.setDescription("<a:loading:929001830766243840> Working on sending the invoice...");
        else if (userProg.sent) {
            embed.setAuthor({name: 'Invoice - Scan to Pay', iconURL: 'https://www.gcnt.net/inc/img/discord-finance-bot-sent.png'});
            embed.setFooter({
                text: 'Check your email or scan the QR code to pay this invoice with PayPal.',
                iconURL: this.botLogo
            })

            if (userProg.qr_code != null) {
                const sfbuff = new Buffer.from(userProg.qr_code, "base64");
                const sfattach = new AttachmentBuilder(sfbuff).setName("qr.png");

                const res = await channel.guild.channels.cache.get(process.env.CHANNEL_BOT_MESSAGING).send({files: [sfattach]});
                const qrUrl = res.attachments.first().attachment;
                embed.setThumbnail(qrUrl);
            }
        }

        if (userProg.customer != null) {
            let recipientInfo = `<@${userProg.customer.id}> - ${userProg.customer_info.first_name + " " + userProg.customer_info.last_name}\n${userProg.customer_info.email}\n`;
            if (userProg.customer_info.business != null) {
                recipientInfo += `${userProg.customer_info.business}`;
            }
            embed.addFields({name: "Recipient info", value: recipientInfo, inline: true});
        }
        if (userProg.invoice_number != null) {
            embed.addFields(
                {name: "Invoice", value: `#${userProg.invoice_number}`, inline: true},
                {name: "Subtotal", value: `${getTotal(userProg.items)}`, inline: true}
            );
        }

        let number = 0;
        let finished = false;
        if (userProg.items != null) {
            // items array exists (actually always does)
            for (let item of userProg.items) {
                // iterating through all items.
                if (item?.name != null && item?.description != null && item?.measure_unit != null && item?.rate != null) {
                    // item is valid.
                    embed.addFields(getItemField(item));
                    number++;
                    finished = true;
                } else if (finished) {
                    // item is not valid.
                    finished = false;
                    break;
                }
            }
        }

        const row = new ActionRowBuilder();
        // execute this when no valid items OR there are valid items but user is currently editing one.
        if (finished && !userProg.sent && !userProg.sending) {
            if (userProg.items != null && number !== 0) {
                row.addComponents(new ButtonBuilder()
                    .setCustomId('submit-invoice')
                    .setLabel('Submit')
                    .setStyle("SUCCESS"));
            }
        }
        if ((finished || userProg.items.length < 1) && !userProg.sent && !userProg.sending) {
            row.addComponents(new ButtonBuilder()
                .setCustomId('add-invoice-item')
                .setLabel('Add item')
                .setStyle("PRIMARY"),
            );
        }

        let msgObj = {embeds: [embed], components: []};
        if (row.components.length !== 0) {
            msgObj.components = [row];
        }

        if (userProg.new_message != null) {
            userProg.new_message.edit(msgObj);
        } else {
            channel.send(msgObj).then(sent => userProg.new_message = sent);
        }

        if (userProg.sent) {
            try {
                if (userProg.private_message == null) {
                    const customerId = userProg.customer.id;
                    const fetchedUser = await this.client.users.fetch(customerId, {force: true});
                    const sentMsg = await fetchedUser.send(msgObj);
                    userProg.private_message = sentMsg;
                } else {
                    await userProg.private_message.edit(msgObj);
                }
            } catch (e) {
                console.log("Cannot send private message to user " + userProg.customer.id);
            }

            this.userProgress.delete(ownerId);
        }
    }

    /**
     * @param {ButtonInteraction} interaction
     * @param userProg
     */
    handleDiscardInvoiceInteraction(interaction, userProg) {
        userProg.new_message?.delete().catch();
        this.userProgress.delete(interaction.user.id);
        interaction.deleteReply().catch();
    }

    /**
     * @param {ButtonInteraction} interaction
     * @param userProg
     */
    handleItemGoBackInteraction(interaction, userProg) {
        const userSub = userProg?.subject;

        this.ignoreReply(interaction);
        const item = userProg.items[userProg.items.length - 1];
        switch (userSub) {
            case InvoiceActionType.ENTER_DESCRIPTION: {
                delete item.name;
                userProg.subject = InvoiceActionType.ENTER_NAME;
                break;
            }
            case InvoiceActionType.ENTER_MEASURE_UNIT: {
                delete item.description;
                userProg.subject = InvoiceActionType.ENTER_DESCRIPTION;
                break;
            }
            case InvoiceActionType.ENTER_RATE: {
                delete item.measure_unit;
                userProg.subject = InvoiceActionType.ENTER_MEASURE_UNIT;
                break;
            }
            case InvoiceActionType.ENTER_QUANTITY: {
                delete item.rate;
                userProg.subject = InvoiceActionType.ENTER_RATE;
                break;
            }
            case InvoiceActionType.REVIEW_ITEM: {
                if (item.measure_unit === "HOURS") {
                    delete item.quantity;
                    userProg.subject = InvoiceActionType.ENTER_QUANTITY;
                } else {
                    delete item.rate;
                    userProg.subject = InvoiceActionType.ENTER_RATE;
                }
            }
        }
        this.sendNewItemMessage(interaction.channel, userProg);
    }

    /**
     * @param {ButtonInteraction} interaction
     * @param userProg
     */
    handleCancelItemInteraction(interaction, userProg) {
        this.ignoreReply(interaction);
        this.sendNewItemMessage(interaction.channel, userProg)
    }

    /**
     * @param {ButtonInteraction} interaction
     * @param userProg
     */
    handleCancelItemConfirmInteraction(interaction, userProg) {
        userProg.cancelling_item = false;
        this.ignoreReply(interaction);

        userProg.last_item_message?.delete().catch();
        delete userProg.last_item_message;
        try {
            userProg.items.splice(userProg.items.length - 1, 1);
        } catch (error) {
            console.error(error);
        }
        userProg.subject = InvoiceActionType.ADD_ITEMS;
        this.sendUpdateNewInvoiceMessage(interaction.channel, interaction.user.id, userProg).catch();
    }


    /**
     *
     * @param {BaseInteraction} interaction
     * @returns {Promise<void>}
     */
    async handleInteraction(interaction) {
        if (interaction.isCommand()) {
            if (interaction.commandName === "create-invoice") {
                this.sendNewInvoiceMessage(interaction);
            }
        } else if (interaction.isButton()) {
            const userProg = this.userProgress.get(interaction.user.id);
            const userSub = userProg?.subject;

            if (interaction.customId === "cancel-new-invoice") {
                interaction.deleteReply().catch();
                return;
            } else if (interaction.customId === "discard-invoice") {
                this.handleDiscardInvoiceInteraction(interaction, userProg);
                return;
            } else if (interaction.customId === "item-go-back") {
                this.handleItemGoBackInteraction(interaction, userProg);
                return;
            } else if (interaction.customId === "cancel-item") {
                this.handleCancelItemInteraction(interaction, userProg);
                return;
            }

            if (userProg?.cancelling_item) {
                if (interaction.customId === "confirm-cancel-item") {
                    this.handleCancelItemConfirmInteraction(interaction, userProg);
                } else if (interaction.customId === "cancel-cancel-item") {
                    this.sendNewItemMessage(interaction.channel, userProg)
                }
            } else if (userSub === InvoiceActionType.ADD_ITEMS) {
                if (interaction.customId === "submit-invoice") {
                    this.handleSubmitInvoiceInteraction(interaction, userProg).catch();
                } else if (interaction.customId === "add-invoice-item") {
                    this.handleAddInvoiceItemInteraction(interaction, userProg).catch();
                }
            } else if (userSub === InvoiceActionType.ENTER_MEASURE_UNIT) {
                if (interaction.customId.startsWith("mu-")) {
                    this.handleSelectMeasureUnitInteraction(interaction, userProg);
                }
            } else if (userSub === InvoiceActionType.REVIEW_ITEM) {
                if (interaction.customId === "submit-item") {
                    this.handleSubmitItemInteraction(interaction, userProg).catch();
                }
            }
        }
    }

    /**
     * @param {ButtonInteraction} interaction
     * @param userProg
     */
    async handleSubmitInvoiceInteraction(interaction, userProg) {
        this.ignoreReply(interaction);
        userProg.sending = true;
        await this.sendUpdateNewInvoiceMessage(interaction.channel, interaction.user.id, userProg);

        try {
            const res = await createDraft(userProg);
            await sendInvoice(userProg, res["href"]);
            await this.sendUpdateNewInvoiceMessage(interaction.channel, interaction.user.id, userProg);
            const qr = await getQRCode(res["href"]);
            userProg.qr_code = qr.split("\n")[4];

            await this.sendUpdateNewInvoiceMessage(interaction.channel, interaction.user.id, userProg);
        } catch (error) {
            console.error(error);
        }
    }

    /**
     * @param {ButtonInteraction} interaction
     * @param userProg
     */
    async handleAddInvoiceItemInteraction(interaction, userProg) {
        this.ignoreReply(interaction);
        userProg.subject = InvoiceActionType.ENTER_NAME;
        userProg.items[userProg.items.length] = {};
        await this.sendUpdateNewInvoiceMessage(interaction.channel, interaction.user.id, userProg);
        this.sendNewItemMessage(interaction.channel, userProg);
    }

    /**
     * @param {ButtonInteraction} interaction
     * @param userProg
     */
    handleSelectMeasureUnitInteraction(interaction, userProg) {
        this.ignoreReply(interaction);
        userProg.items[userProg.items.length - 1].measure_unit = interaction.customId.replace("mu-", "");
        userProg.subject = InvoiceActionType.ENTER_RATE;
        this.sendNewItemMessage(interaction.channel, userProg);
    }

    /**
     * @param {ButtonInteraction} interaction
     * @param userProg
     */
    async handleSubmitItemInteraction(interaction, userProg) {
        this.ignoreReply(interaction);
        userProg.last_item_message?.delete().catch();

        delete userProg.last_item_message;
        await this.sendUpdateNewInvoiceMessage(interaction.channel, interaction.user.id, userProg);
        userProg.subject = InvoiceActionType.ADD_ITEMS;
    }

    /**
     *
     * @param {TextChannel} channel
     * @param {String} title
     * @param {String} description
     * @returns {Promise<*|null>}
     */
    async sendErrorMessage(channel, title, description) {
        const embed = new EmbedBuilder()
            .setColor('#ff6666')
            .setAuthor({name: title, iconURL: 'https://www.freeiconspng.com/uploads/red-circular-image-error-0.png'})
            .setDescription(description);
        const sent = await channel.send({embeds: [embed]});
        try {
            return sent;
        } catch (error) {
            return null;
        }
    }

    /**
     * @param {ButtonInteraction} interaction
     */
    ignoreReply(interaction) {
        interaction.deferUpdate().catch();
    }

}

module.exports = InvoicingBot;