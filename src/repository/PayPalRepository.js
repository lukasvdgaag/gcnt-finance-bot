import Repository from "./Repository.js";

export default class PayPalRepository extends Repository {

    constructor(pool) {
        super(pool);
    }

    async fetchPayPalUserInformation(discordId) {
        const res = await this.executeSQL(`SELECT COALESCE(p.first_name, u.first_name) AS first_name,
                              COALESCE(p.last_name, u.last_name)   AS last_name,
                              COALESCE(p.email, u.email)           AS email,
                              p.business
                       FROM users AS u
                                LEFT JOIN user_paypal p ON u.id = p.user
                       WHERE u.discord_id = ?
                         AND u.discord_verified = 1
                       LIMIT 1;`, [discordId])
        return res[0] ?? null;
    }

    async fetchTransactionInformation(transactionId) {
        const res = await this.executeSQL(`SELECT *, p.name AS plugin_title
                           FROM mygcnt_payments AS mp
                                    LEFT JOIN plugins p on mp.plugin_id = p.id
                           WHERE txnid = ?;`
            , [transactionId]);
        return res[0] ?? null;
    }

    async getUserInformation(userId) {
        const res = await this.executeSQL(`SELECT discord
                           FROM users
                           WHERE id = ?;`, [userId]);
        return res[0] ?? null;
    }

}