import mysql from "mysql";

export default class Repository {

    /**
     * @type {Pool}
     */
    static pool;
    static {
        Repository.pool = mysql.createPool({
            host: process.env.MYSQL_HOST,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASS,
            database: process.env.MYSQL_DB,
            connectionLimit: 10
        });
    }

    async executeSQL(query, values = []) {
        return new Promise(async (ok, fail) => {
            Repository.pool.getConnection(function (err, connection) {
                if (err) {
                    connection.release();
                    fail(err);
                    return;
                }
                connection.query(query, function (err, result) {
                    connection.release();
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