const {MessageEmbed} = require("discord.js");
const {round, sendRequest} = require("./paypal.js");

require('dotenv').config();
const mysql = require('mysql');

class PaymentMessenger {

    #client;

    constructor(client) {
        this.#client = client;
    }

    #getConnection() {
        return mysql.createConnection({
            host: process.env.MYSQL_HOST,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASS,
            database: 'gaagjescraft'
        });
    }

    async processMessage(msg) {
        if (msg.channelId !== "929499058828103730") {
            console.log("Not in the right channel");
            return;
        }
        if (msg.webhookId == null) {
            console.log("Not a webhook");
            return;
        }
        if (msg.embeds.length === 0) {
            console.log("No embeds");
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
            console.log("Transaction info");
            console.log(transactionInfo);

            const emb = new MessageEmbed()
                .setColor(process.env.COLOR)
                .setAuthor({name: 'Thanks for your purchase!', iconURL: 'https://www.gcnt.net/inc/img/discord-finance-bot-check.png'})
                .setFooter({text: "Purchased through PayPal", iconURL: 'https://www.gcnt.net/inc/img/discord-finance-bot-logo.png'});

            if (transactionInfo.plugin_title != null) emb.addField("Plugin", transactionInfo.plugin_title, true);

            if (invoiceId != null) {
                const invoiceInfo = await this.getInvoiceInfo(invoiceId);
                console.log("invoiceInfo");
                console.log(invoiceInfo);
                if (invoiceInfo != null) {
                    emb.addField("Invoice", invoiceId, false);
                    emb.addField("Amount", round(transactionInfo.payment_amount) + " EUR", true);
                    const status = invoiceInfo.status;

                    if (status === "PAID" || status === "MARKED_AS_PAID") {
                        emb.addField("Invoice Status", ":white_check_mark: Fully paid", true);
                    } else {
                        const dueAmount = invoiceInfo.due_amount.value;

                        emb.addField("Invoice Status", `:warning: The invoice is not fully paid yet. There is a remainder of ${round(dueAmount)} EUR.`, false);
                    }
                }
            } else {
                emb.addField("Price", round(transactionInfo.price) + " EUR", true);
            }

            console.log("sending message");
            discordUser.send({embeds: [emb], components: []});
        }
    }

    async getInvoiceInfo(invoiceId) {
        return await sendRequest(`https://api-m.paypal.com/v2/invoicing/invoices/${invoiceId}`, undefined, "GET");
    }

    async #getTransactionInfo(transactionId) {
        const clas = this;
        return new Promise(async function (ok, fail) {
            const con = clas.#getConnection();
            con.connect(function (err) {
                if (err) {
                    fail(err);
                    return;
                }
                con.query(`SELECT *, p.name AS plugin_title
                           FROM mygcnt_payments AS mp
                                    LEFT JOIN plugins p on mp.plugin_id = p.id
                           WHERE txnid = ?;`
                    , [transactionId],
                    function (err, result, fields) {
                        if (err) {
                            fail(err);
                            return;
                        }
                        ok(result[0] ?? null);
                    });
            });
        });
    }

    async #getUserInfo(userId) {
        const clas = this;
        return new Promise(async function (ok, fail) {
            const con = clas.#getConnection();
            con.connect(function (err) {
                if (err) {
                    fail(err);
                    return;
                }
                con.query(`SELECT discord
                           FROM users
                           WHERE id = ?;`, [userId],
                    function (err, result, fields) {
                        if (err) {
                            fail(err);
                            return;
                        }
                        ok(result[0] ?? null);
                    });
            });
        });
    }
}

module.exports = PaymentMessenger;