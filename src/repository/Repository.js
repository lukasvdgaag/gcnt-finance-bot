import mysql from "mysql";

export default class Repository {

    static pool;
    static {
        Repository.pool = mysql.createPool({
            host: process.env.MYSQL_HOST,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASS,
            database: process.env.MYSQL_DB,
            connectionLimit: 10,
        });
    }

    async executeSQL(query, values = []) {
        Repository.pool.getConnection((err, conn) => {
            if (err) {
                console.error(err);
                return null;
            }

            conn.query(query, values, (err, results, fields) => {
                conn.release();

                if (err) {
                    console.error(err);
                    return null;
                }

                return results;
            });
        });
    }

}