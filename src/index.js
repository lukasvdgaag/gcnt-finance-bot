import dotenv from "dotenv";
import InvoicingBot from './invoicing-bot.js';
import CustomProjects from './custom_projects.js';
import HttpServer from './httpServer.js';

dotenv.config({path: './.env'});

const pluginInstance = new CustomProjects();
const httpInstance = new HttpServer(pluginInstance);
const invoicingBot = new InvoicingBot();