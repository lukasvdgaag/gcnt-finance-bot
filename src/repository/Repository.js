export default class Repository {

    pool;

    constructor(pool) {
        this.pool = pool;
    }

    async executeSQL(query, values = []) {
        return new Promise((resolve, reject) => {
            this.pool.getConnection((err, conn) => {
                if (err) {
                    console.error(err);
                    resolve(null);
                    return;
                }

                conn.query(query, values, (err, results, fields) => {
                    conn.release();

                    if (err) {
                        console.error(err);
                        resolve(null);
                        return;
                    }

                    resolve(results);
                });
            });
        });
    }

}