require('dotenv').config({path: __dirname + '/.env'});

const InvoicingBot = require('./invoicing-bot.js');
const CustomPlugins = require('./custom_plugins.js');
const HttpServer = require('./httpServer.js');

const pluginInstance = new CustomPlugins();
const httpInstance = new HttpServer(pluginInstance);
const invoicingBot = new InvoicingBot();