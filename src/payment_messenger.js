import {round, sendRequest} from "./paypal.js";
import {EmbedBuilder} from "discord.js";
import {RepositoryManager} from "./index.js";

export default class PaymentMessenger {

    #client;

    constructor(client) {
        this.#client = client;
    }

    async processMessage(msg) {
        if (msg.channelId !== "929499058828103730") {
            return;
        }
        if (msg.webhookId == null) {
            return;
        }
        if (msg.embeds.length === 0) {
            return;
        }

        if (msg.content.startsWith("new:payment|")) {
            console.log("New payment");
            const parts = msg.content.split("|");
            const transactionId = parts[1];
            const invoiceId = parts[2] ?? null;

            const embed = msg.embeds[0];
            if (embed == null) {
                console.log("embed is null")
                return;
            }

            let gcntUserId = null;
            for (let field of embed.fields) {
                if (field.name === "GCNT User") {
                    gcntUserId = field.value;
                }
            }

            if (gcntUserId == null) {
                console.log("No GCNT User");
                return;
            }
            const userInfo = await this.#getUserInfo(gcntUserId);
            if (userInfo == null) {
                console.log("No user info");
                return;
            }

            let query = userInfo.discord.split("#")[0];
            console.log("discord username: " + query);
            const result = await msg.guild.members.search({
                query: query,
                limit: 10
            });

            const discordUser = result.find(usr => usr.user.tag === userInfo.discord);
            if (discordUser == null) {
                console.log("No discord user");
                return;
            }

            const transactionInfo = await this.#getTransactionInfo(transactionId);
            if (transactionInfo == null) {
                console.log("No transaction info");
                return;
            }

            const emb = new EmbedBuilder()
                .setColor(process.env.THEME_COLOR)
                .setAuthor({name: 'Thanks for your purchase!', iconURL: 'https://www.gcnt.net/inc/img/discord-finance-bot-check.png'})
                .setFooter({text: "Purchased through PayPal", iconURL: 'https://www.gcnt.net/inc/img/discord-finance-bot-logo.png'});

            if (transactionInfo.plugin_title != null) emb.addFields({name: "Plugin", value: transactionInfo.plugin_title, inline: true});

            if (invoiceId != null) {
                const invoiceInfo = await this.getInvoiceInfo(invoiceId);
                if (invoiceInfo != null) {
                    emb.addFields(
                        {name: "Invoice", value: invoiceId, inline: false},
                        {name: "Amount", value: round(transactionInfo.payment_amount) + " EUR", inline: true}
                    );
                    const status = invoiceInfo.status;

                    if (status === "PAID" || status === "MARKED_AS_PAID") {
                        emb.addFields({name: "Invoice Status", value: ":white_check_mark: Fully paid", inline: true});
                    } else {
                        const dueAmount = invoiceInfo.due_amount.value;
                        emb.addFields({
                            name: "Invoice Status",
                            value: ":warning: The invoice is not fully paid yet. There is a remainder of " + round(dueAmount) + " EUR.",
                            inline: false
                        });
                    }
                }
            } else {
                emb.addFields({name: "Price", value: round(transactionInfo.price) + " EUR", inline: true});
            }

            console.log("sending message");
            try {
                discordUser.send({embeds: [emb], components: []});
            } catch (e) {
                console.log("Error sending message to user " + discordUser.user.tag);
            }
        }
    }

    async getInvoiceInfo(invoiceId) {
        return await sendRequest(`https://api-m.paypal.com/v2/invoicing/invoices/${invoiceId}`, undefined, "GET");
    }

    async #getTransactionInfo(transactionId) {
        return await RepositoryManager.payPalRepository.fetchTransactionInformation(transactionId);
    }

    async #getUserInfo(userId) {
        return await RepositoryManager.payPalRepository.getUserInformation(userId);
    }
}