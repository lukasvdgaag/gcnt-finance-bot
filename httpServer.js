require('dotenv').config({path: __dirname + '/.env'});
const express = require('express');
const app = express();

app.use(express.json());

const PORT = 3001;

class HttpServer {

    customPlugins;

    constructor(customPlugins) {
        this.customPlugins = customPlugins;

        app.post('/ticketPricingUpdate/:pricingId/:ticketId', (req, res) => {
            if (req.header('Auth') !== process.env.TICKET_AUTH) {
                console.log('Invalid Auth');
                console.log("Auth provided:  " + req.header("Auth"));
                console.log("Auth required:  " + process.env.TICKET_AUTH)
                res.sendStatus(401);
                return;
            }

            const pricingId = req.params.pricingId;
            const ticketId = req.params.ticketId;

            const body = req.body;

            this.customPlugins.handlePricingUpdate(pricingId, ticketId, body);
            res.sendStatus(200);
        });

        app.listen(PORT, () => console.log(`Server listening on port: ${PORT}`));
    }
}

module.exports = HttpServer;

