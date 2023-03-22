import dotenv from "dotenv";
import * as path from "path";
import RepoManager from "./repository/RepositoryManager.js";
import InvoicingBot from './invoicing-bot.js';
import CustomProjects from './custom_projects.js';
import HttpServer from './httpServer.js';

console.log(dotenv.config({path: path.dirname(new URL(import.meta.url).pathname.replace('/C:', 'C:')) + "/.env"}));
export const RepositoryManager = new RepoManager();

const pluginInstance = new CustomProjects();
const httpInstance = new HttpServer(pluginInstance);
const invoicingBot = new InvoicingBot();