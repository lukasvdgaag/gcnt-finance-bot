import dotenv from "dotenv";
import express from 'express';

dotenv.config();
const app = express();

app.use(express.json());

const PORT = 8081;

export default class HttpServer {

    customPlugins;

    constructor(customPlugins) {
        this.customPlugins = customPlugins;

        app.post('/ticketPricingUpdate/:pricingId/:ticketId', (req, res) => {
            if (req.header('Auth') !== process.env.TICKET_AUTH) {
                res.sendStatus(401);
                return;
            }

            const pricingId = req.params.pricingId;
            const ticketId = req.params.ticketId;

            const body = req.body;

            this.customPlugins.handlePricingUpdate(pricingId, ticketId, body);
            res.sendStatus(200);
        });

        this.listen();
    }

    async listen() {
        const server = await app.listen(PORT, () => console.log(`Server listening on port: ${PORT}`));
        server.on('close', () => {
            setTimeout(() => {
                this.listen()
            }, 1000)
        });


    }
}

