require('dotenv').config();
const mysql = require('mysql');
const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
const formatter = new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
});
let accessToken = "";

async function getPayPalUserInfo(userDiscord) {
    return new Promise(async function (ok, fail) {
        const con = mysql.createConnection({
            host: process.env.MYSQL_HOST,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASS,
            database: 'gaagjescraft'
        });
        con.connect(function (err) {
            if (err) {
                fail(err);
                return;
            }
            con.query(`SELECT COALESCE(p.first_name, u.first_name) AS first_name,
                              COALESCE(p.last_name, u.last_name)   AS last_name,
                              COALESCE(p.email, u.email)           AS email,
                              p.business
                       FROM users AS u
                                LEFT JOIN user_paypal p ON u.id = p.user
                       WHERE u.discord_id = ?
                         AND u.discord_verified = 1
                       LIMIT 1;`, [userDiscord],
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

async function getAccessToken() {
    const req = new XMLHttpRequest();
    req.onload = () => {
        // console.log(req.responseText);
        if (req.status === 200) {
            const json = JSON.parse(req.responseText);
            accessToken = json["access_token"];
            const expiresIn = json["expires_in"];
            setTimeout(getAccessToken, expiresIn * 900);
        }
    };
    req.open("POST", "https://api.paypal.com/v1/oauth2/token");
    req.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    req.setRequestHeader("Accept", "application/json");
    req.setRequestHeader("Accept-Language", "en_US");
    let value = "Basic " + btoa(`${process.env.PAYPAL_CLIENT}:${process.env.PAYPAL_SECRET}`);
    req.setRequestHeader("Authorization", value)
    req.send("grant_type=client_credentials");
}

function sendRequest(url, data = undefined, type = "POST", headers = {}) {
    return new Promise(async function (ok, fail) {
        const req = new XMLHttpRequest();
        req.onload = () => {
            if (req.status >= 200 && req.status < 300) {
                // return the entire response text as json.
                try {
                    ok(JSON.parse(req.responseText) ?? "no response json");
                } catch (error) {
                    ok(req.responseText ?? "no response text");
                }
            } else {
                fail({code: req.status, text: req.responseText});
            }
        };
        req.open(type, url);
        req.setRequestHeader("Content-Type", "application/json");
        console.log("Tokkie: " + accessToken);
        req.setRequestHeader("Authorization", `Bearer ${accessToken}`);
        for (const header in headers) {
            req.setRequestHeader(header, headers[header]);
        }
        if (data) req.send(data);
        else req.send();
    });
}

function createDraft(userProg) {
    return new Promise(async function (ok, fail) {
        const invoiceNumber = userProg.invoice_number;
        const data = {
            detail: {
                invoice_number: invoiceNumber,
                currency_code: 'EUR',
                term: 'https://www.gcnt.net/terms-of-service'
            },
            invoicer: {
                business_name: "GCNT",
                name: {
                    given_name: "Lukas",
                    surname: "van der Gaag",
                },
                email_address: "gaagjescraft@gmail.com",
                website: 'https://www.gcnt.net/',
                logo_url: 'https://www.gcnt.net/inc/img/logo.png'
            },
            primary_recipients: [{
                billing_info: {
                    name: {
                        given_name: userProg.customer_info.first_name,
                        surname: userProg.customer_info.last_name
                    },
                    email_address: userProg.customer_info.email,
                    business_name: userProg.customer_info.business
                }
            }],
            items: [],
            configuration: {
                allow_tip: true,
                partial_payment: {
                    allow_partial_payment: true,
                    allow_partial_payment_amount: {
                        currency_code: 'EUR',
                        value: userProg.amount
                    }
                },
                tax_inclusive: false,
            }
        };

        let total = 0;

        for (const item of userProg.items) {
            let quantity = item.measure_unit === "HOURS" ? item.quantity : 1;

            const itemData = {
                name: item.name,
                description: item.description,
                unit_of_measure: item.measure_unit,
                unit_amount: {
                    currency_code: 'EUR',
                    value: item.rate
                },
                quantity: quantity
            }

            total += quantity * item.rate;
            data.items.push(itemData);
        }

        data.configuration.partial_payment.allow_partial_payment_amount.value = Math.round((total / 2) * 100) / 100;

        const json = JSON.stringify(data);
        sendRequest("https://api.paypal.com/v2/invoicing/invoices", json)
            .then(res => {
                ok(res);
            })
            .catch(error => {
                console.error(error);
                fail();
            });
    });
}

function getQRCode(link) {
    return new Promise(async function (ok, fail) {
        sendRequest(link + "/generate-qr-code", '{"action":"pay"}').then(res => {
            ok(res);
        }).catch(error => {
            console.error(error)
            fail();
        });
    });
}

function sendInvoice(userProg, link) {
    return new Promise(async function (ok, fail) {
        sendRequest(link + "/send", `{"send_to_invoicer":true}`).then(() => {
            userProg.sending = false;
            userProg.sent = true;
            ok();
        }).catch(error => {
            console.error(error)
            fail();
        });
    });
}

function round(number) {
    return formatter.format(number).replace('€', "").trim();
}

function getTotal(items) {
    let total = 0;
    for (const item of items) {
        let quantity = item?.quantity ?? 1;
        let rate = item?.rate ?? 0;
        total += quantity * rate;
    }

    if (total === 0) return "FREE";
    else return round(total);
}

/**
 *
 * @param item
 * @returns {{name, value: string}}
 */
function getItemField(item) {
    let price;
    if (item.measure_unit === "HOURS") {
        price = `__${round(item.quantity)} hours x${round(item.rate)} EUR__`
    } else {
        price = `__${round(item.rate)} EUR__`
    }

    return {
        name: item.name,
        value: price + "\n" + item.description
    }
}

module.exports = {
    sendRequest: sendRequest,
    getAccessToken: getAccessToken,
    createDraft: createDraft,
    sendInvoice: sendInvoice,
    getQRCode: getQRCode,
    round: round,
    getItemField: getItemField,
    getTotal: getTotal,
    getPayPalUserInfo: getPayPalUserInfo
}