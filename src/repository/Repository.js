import mysql from "mysql";

export default class Repository {

    getConnection() {
        return mysql.createConnection({
            host: process.env.MYSQL_HOST,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASS,
            database: process.env.MYSQL_DB
        });
    }

    async executeSQL(query, values = []) {
        return new Promise(async (ok, fail) => {
            const connection = this.getConnection();
            connection.connect(function (err) {
                if (err) {
                    fail(err);
                    return;
                }
                connection.query(query, values,
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

}