import dotenv from "dotenv";
import InvoicingBot from './invoicing-bot.js';
import CustomProjects from './custom_projects.js';
import HttpServer from './httpServer.js';
import * as path from "path";

dotenv.config({path: path.dirname(new URL(import.meta.url).pathname) + "/.env"});

const pluginInstance = new CustomProjects();
const httpInstance = new HttpServer(pluginInstance);
const invoicingBot = new InvoicingBot();