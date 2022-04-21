const express = require('express');
const app = express();

// const bodyParser = require('body-parser');
app.use(express.json());
// app.use(bodyParser.urlencoded({
//     extended: false
// }));

const PORT = 3001;

class HttpServer {

    customPlugins;

    constructor(customPlugins) {
        this.customPlugins = customPlugins;

        app.post('/ticketPricingUpdate/:pricingId/:ticketId', (req, res) => {
            if (req.header('Auth') !== "JRjd}bt7vL9(=`#_]'qXhn~>[$/NJcg\"D7!`Hcde{PQ4Zkd@(8%r;K+xZmSfCntp") {
                console.log('Invalid Auth');
                res.sendStatus(401);
                return;
            }

            const pricingId = req.params.pricingId;
            const ticketId = req.params.ticketId;

            const body = req.body;

            console.log("ticketPricingUpdate");
            console.log(body);
            this.customPlugins.handlePricingUpdate(pricingId, ticketId, body);
            res.sendStatus(200);
        });

        app.listen(PORT, () => console.log(`Server listening on port: ${PORT}`));
    }
}

module.exports = HttpServer;

