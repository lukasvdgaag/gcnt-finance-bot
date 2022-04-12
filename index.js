require('dotenv').config({path: __dirname + '/.env'});

const Discord = require('discord.js');
const {MessageEmbed, MessageActionRow, MessageButton} = require("discord.js");
const {createDraft, sendInvoice, getQRCode, sendRequest, getItemField, getTotal, round, getPayPalUserInfo, getAccessToken} = require("./paypal");
const PaymentMessenger = require("./payment_messenger.js");
const botLogo = 'https://www.gcnt.net/inc/img/discord-finance-bot-logo.png';
const userProgress = new Map();
let paymentMessenger;

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

const client = new Discord.Client({intents: ["GUILDS", "GUILD_MESSAGES", "GUILD_MEMBERS", "GUILD_MESSAGE_REACTIONS"]}); //create new client

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    paymentMessenger = new PaymentMessenger(client);

    getAccessToken();
});

//make sure this line is the last line
client.login(process.env.CLIENT_TOKEN); //login bot using token

client.on('messageCreate', async (msg) => {
    paymentMessenger.processMessage(msg);

    if (msg.channelId !== "807990882104115230" || msg.author.bot) return;

    if (msg.content === "newInvoice") {
        sendInvoiceMessage(msg.channel);
        return;
    }

    const userProg = userProgress.get(msg.author.id);
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
        userProgress.delete(msg.author.id);
        const error = await sendErrorMessage(msg.channel, "Invoice cancelled!", "Your current PayPal Invoice Setup has been discarded.");
        setTimeout(() => error.delete(), 8000);
        return;
    }

    if (userSub === InvoiceActionType.CUSTOMER) {
        msg.delete().then();

        const mentioned = msg.content;
        const result = await msg.guild.members.search({
            query: mentioned
        });
        const member = result.at(0);

        if (member == null) {
            sendErrorMessage(msg.channel, "No user found!", "We couldn't find a user in this Discord with the entered username. Please enter the username of the user that you want to create the invoice for.")
                .then(r => userProg.last_error_msg = r);
        } else {
            userProg.customer_info = await getPayPalUserInfo(member.user.tag);
            if (userProg.customer_info == null) {
                sendErrorMessage(msg.channel, "No MyGCNT User Found!", "We failed to find a MyGCNT user with that Discord name, or their account is not discord-verified. Please make sure this the entered Discord name is linked to a verified MyGCNT account.")
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
                    sendUpdateNewInvoiceMessage(msg.channel, msg.author.id, userProg);
                })
                .catch(err => console.error(err));
            userProg.subject = InvoiceActionType.ADD_ITEMS;
        }
    } else if (userSub === InvoiceActionType.ENTER_NAME && lastItem != null) {
        msg.delete().then();
        lastItem.name = msg.content;
        userProg.subject = InvoiceActionType.ENTER_DESCRIPTION;
        sendNewItemMessage(msg.channel, userProg);
    } else if (userSub === InvoiceActionType.ENTER_DESCRIPTION && lastItem != null) {
        msg.delete().then();
        lastItem.description = msg.content;
        userProg.subject = InvoiceActionType.ENTER_MEASURE_UNIT;
        sendNewItemMessage(msg.channel, userProg);
    } else if (userSub === InvoiceActionType.ENTER_RATE && lastItem != null) {
        msg.delete().then();
        if (Number.isNaN(msg.content)) {
            sendErrorMessage(msg.channel, "Rate not a number!", "The amount you entered is not a valid number.").then(r => userProg.last_error_msg = r);
        } else if (Number.parseFloat(msg.content) < 0) {
            sendErrorMessage(msg.channel, "Rate too low!", "The number you entered must be 0 or greater.").then(r => userProg.last_error_msg = r);
        } else {
            lastItem.rate = Number.parseFloat(msg.content);
            userProg.subject = lastItem.measure_unit === "HOURS" ? InvoiceActionType.ENTER_QUANTITY : InvoiceActionType.REVIEW_ITEM;
            sendNewItemMessage(msg.channel, userProg);
        }
    } else if (userSub === InvoiceActionType.ENTER_QUANTITY && lastItem != null && lastItem.measure_unit === "HOURS") {
        msg.delete().then();
        if (Number.isNaN(msg.content)) {
            sendErrorMessage(msg.channel, "Quantity not a number!", "The amount you entered is not a valid number.").then(r => userProg.last_error_msg = r);
        } else if (Number.parseFloat(msg.content) < 0) {
            sendErrorMessage(msg.channel, "Quantity too low!", "The number you entered must be 0 or greater.").then(r => userProg.last_error_msg = r);
        } else {
            lastItem.quantity = Number.parseFloat(msg.content);
            userProg.subject = InvoiceActionType.REVIEW_ITEM;
            sendNewItemMessage(msg.channel, userProg);
        }
    }
});

async function sendUpdateNewInvoiceMessage(channel, ownerId, userProg) {
    const embed = new MessageEmbed()
        .setColor(process.env.COLOR)
        .setAuthor({name: 'Creating a new invoice', iconURL: 'https://www.gcnt.net/inc/img/discord-finance-bot-logo.png'})
        .setTimestamp()
        .setFooter({text: 'Type "cancel" to cancel this invoice.'});

    if (userProg.sending) embed.setDescription("<a:loading:929001830766243840> Working on sending the invoice...");
    else if (userProg.sent) {
        embed.setAuthor({name: 'Invoice - Scan to Pay', iconURL: 'https://www.gcnt.net/inc/img/discord-finance-bot-sent.png'});
        embed.setFooter({
            text: 'Check your email or scan the QR code to pay this invoice with PayPal.',
            iconURL: 'https://www.gcnt.net/inc/img/discord-finance-bot-logo.png'
        })

        if (userProg.qr_code != null) {
            const sfbuff = new Buffer.from(userProg.qr_code, "base64");
            const sfattach = new Discord.MessageAttachment(sfbuff, "qr.png");

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
        embed.addField("Recipient info", recipientInfo, true);
    }
    if (userProg.invoice_number != null) {
        embed.addField("Invoice", `#${userProg.invoice_number}`, true);
        embed.addField("Subtotal", `${getTotal(userProg.items)}`, true);
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

    const row = new MessageActionRow();
    // execute this when no valid items OR there are valid items but user is currently editing one.
    if (finished && !userProg.sent && !userProg.sending) {
        if (userProg.items != null && number !== 0) {
            row.addComponents(new MessageButton()
                .setCustomId('submit-invoice')
                .setLabel('Submit')
                .setStyle("SUCCESS"));
        }
    }
    if ((finished || userProg.items.length < 1) && !userProg.sent && !userProg.sending) {
        row.addComponents(new MessageButton()
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
        if (userProg.private_message == null) {
            const customerId = userProg.customer.id;
            const fetchedUser = await client.users.fetch(customerId, {force: true});
            const sentMsg = await fetchedUser.send(msgObj);
            userProg.private_message = sentMsg;
        } else {
            await userProg.private_message.edit(msgObj);
        }

        userProgress.delete(ownerId);
    }
}

function sendInvoiceMessage(channel) {
    const embed = new MessageEmbed()
        .setColor(process.env.COLOR)
        .setAuthor({name: 'Create a new invoice!', iconURL: 'https://www.gcnt.net/inc/img/discord-finance-bot-logo.png'})
        .setDescription("Click the button below to create a new PayPal invoice for a customer.");
    const row = new MessageActionRow()
        .addComponents(
            new MessageButton()
                .setCustomId('create')
                .setLabel('Create invoice')
                .setStyle("SUCCESS"),
        );

    channel.send({embeds: [embed], components: [row]});
}

function sendNewItemMessage(channel, userProg) {
    const items = userProg?.items;
    const lastItem = items != null && items.length !== 0 ? items[items.length - 1] : null;

    const embed = new MessageEmbed()
        .setColor(process.env.COLOR)
        .setTimestamp();

    let addBackButton = true;
    let description = "Enter the name of the item in the chat.";
    let title = "Enter the name.";
    let row = new MessageActionRow();
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
                embed.addField("Name", lastItem.name, false);
                embed.addField("Description", lastItem.description, false);
                row.addComponents(
                    new MessageButton()
                        .setCustomId('mu-HOURS')
                        .setStyle("PRIMARY")
                        .setLabel("Hours")
                        .setEmoji("⏱️"),
                    new MessageButton()
                        .setCustomId("mu-AMOUNT")
                        .setStyle("PRIMARY")
                        .setLabel("Amount")
                        .setEmoji("💰")
                );
            } else {
                embed.addField("Name", lastItem.name, false);
                embed.addField("Description", lastItem.description, false);

                if (lastItem.measure_unit === "HOURS") {
                    embed.addField("Measure unit", "Hourly", true);

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
                        embed.addField("Hourly rate", lastItem.rate + " EUR", true);
                        embed.addField("Hours spent", lastItem.quantity + "", true);
                        embed.addField("Subtotal", round(lastItem.rate * lastItem.quantity));
                    }
                } else if (lastItem.measure_unit === "AMOUNT") {
                    embed.addField("Measure unit", "Fixed amount", true);

                    if (lastItem.rate == null) {
                        title = "Enter the subtotal.";
                        description = "Enter the amount of money that you want to charge for this item in the chat.";
                    } else {
                        // add everything
                        title = "Review";
                        description = "All information about the item you just created";
                        embed.addField("Subtotal", lastItem.rate + " EUR", true);
                    }
                }

                if (userProg.subject === "REVIEW_ITEM") {
                    row.addComponents(
                        new MessageButton()
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
            new MessageButton()
                .setCustomId("item-go-back")
                .setStyle("SECONDARY")
                .setLabel("Go back")
        );
    }
    row.addComponents(
        new MessageButton()
            .setCustomId("cancel-item")
            .setStyle("DANGER")
            .setLabel("Cancel item")
    );

    if (lastItem != null && userProg.cancelling_item) {
        title = "Cancel item?";
        description = "Select whether you want to go through with the cancellation of this item.";
        row.setComponents(
            new MessageButton()
                .setCustomId("confirm-cancel-item")
                .setStyle("DANGER")
                .setLabel("Cancel item"),
            new MessageButton()
                .setCustomId("cancel-cancel-item")
                .setStyle("PRIMARY")
                .setLabel("Continue item setup")
        )
    }

    embed.setAuthor({name: `[NEW ITEM] ${title}`, iconURL: botLogo});
    embed.setDescription(description);
    embed.setFooter({text: description});

    let msgObj = {embeds: [embed], components: []};
    if (row.components.length !== 0) {
        msgObj.components = [row];
    }

    if (userProg.last_item_message != null) {
        userProg.last_item_message.edit(msgObj);
    } else {
        channel.send(msgObj).then(sent => userProg.last_item_message = sent);
    }
}

async function sendErrorMessage(channel, title, description) {
    const embed = new MessageEmbed()
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

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton() || interaction?.customId == null) return;
    const userProg = userProgress.get(interaction.user.id);
    const userSub = userProg?.subject;

    if (userSub == null) {
        if (interaction.customId !== "create") return;
        userProgress.set(interaction.user.id, {
            subject: InvoiceActionType.CUSTOMER,
            interaction: interaction,
            items: [],
            sending: false,
            sent: false,
            cancelling_item: false
        });
        interaction.reply({
            embeds: [
                new MessageEmbed()
                    .setColor(process.env.COLOR)
                    .setAuthor({name: 'Who is this invoice for?', iconURL: 'https://www.gcnt.net/inc/img/discord-finance-bot-logo.png'})
                    .setDescription("Please enter the username of the user that this invoice is for in the chat.")
            ]
        });
    } else {
        if (interaction.customId === "item-go-back") {
            ignoreReply(interaction);
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
            sendNewItemMessage(interaction.channel, userProg);
            return;
        } else if (interaction.customId === "cancel-item") {
            userProg.cancelling_item = true;
            ignoreReply(interaction);
            await sendNewItemMessage(interaction.channel, userProg);
            return;
        }

        if (userProg.cancelling_item) {
            // user is cancelling an item
            userProg.cancelling_item = false;
            ignoreReply(interaction);
            if (interaction.customId === "confirm-cancel-item") {
                if (userProg.last_item_message != null) userProg.last_item_message.delete();
                delete userProg.last_item_message;
                try {
                    userProg.items.splice(userProg.items.length - 1, 1);
                } catch (error) {
                    console.error(error);
                }
                userProg.subject = InvoiceActionType.ADD_ITEMS;
                await sendUpdateNewInvoiceMessage(interaction.channel, interaction.user.id, userProg);
            } else if (interaction.customId === "cancel-cancel-item") {
                await sendNewItemMessage(interaction.channel, userProg);
            }
            return;
        }

        if (userSub === InvoiceActionType.ADD_ITEMS) {
            if (interaction.customId === "submit-invoice") {
                ignoreReply(interaction);
                userProg.sending = true;
                await sendUpdateNewInvoiceMessage(interaction.channel, interaction.user.id, userProg);

                try {
                    const res = await createDraft(userProg);
                    await sendInvoice(userProg, res["href"]);
                    await sendUpdateNewInvoiceMessage(interaction.channel, interaction.user.id, userProg);
                    const qr = await getQRCode(res["href"]);
                    userProg.qr_code = qr.split("\n")[4];

                    await sendUpdateNewInvoiceMessage(interaction.channel, interaction.user.id, userProg);
                } catch (error) {
                    console.error(error);
                }

            } else if (interaction.customId === "add-invoice-item") {
                ignoreReply(interaction);
                userProg.subject = InvoiceActionType.ENTER_NAME;
                userProg.items[userProg.items.length] = {};
                await sendUpdateNewInvoiceMessage(interaction.channel, interaction.user.id, userProg);
                sendNewItemMessage(interaction.channel, userProg);
            }
        } else if (userSub === InvoiceActionType.ENTER_MEASURE_UNIT) {
            if (interaction.customId.startsWith("mu-")) {
                ignoreReply(interaction);
                userProg.items[userProg.items.length - 1].measure_unit = interaction.customId.replace("mu-", "");
                userProg.subject = InvoiceActionType.ENTER_RATE;
                sendNewItemMessage(interaction.channel, userProg);
            }
        } else if (userSub === InvoiceActionType.REVIEW_ITEM) {
            if (interaction.customId === "submit-item") {
                ignoreReply(interaction);
                if (userProg.last_item_message != null) userProg.last_item_message.delete();
                delete userProg.last_item_message;
                await sendUpdateNewInvoiceMessage(interaction.channel, interaction.user.id, userProg);
                userProg.subject = InvoiceActionType.ADD_ITEMS;
            }
        }
    }
});

function ignoreReply(interaction) {
    try {
        interaction.deferUpdate();
    } catch (error) {
    }
}