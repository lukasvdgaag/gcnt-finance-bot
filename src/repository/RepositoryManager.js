import mysql from "mysql2";
import TicketRepository from "./TicketRepository.js";
import ProjectPricingRepository from "./ProjectPricingRepository.js";
import PayPalRepository from "./PayPalRepository.js";

export default class RepositoryManager {

    pool;
    ticketRepository;
    projectPricingRepository;
    payPalRepository;

    constructor() {
        this.pool = mysql.createPool({
            host: process.env.MYSQL_HOST,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASS,
            database: process.env.MYSQL_DB,
            connectionLimit: 10,
            enableKeepAlive: true,
        });

        this.createTicketRepo();
        this.createProjectPricingRepo();
        this.createPayPalRepo();
    }

    createTicketRepo() {
        this.ticketRepository = new TicketRepository(this.pool);
    }

    createProjectPricingRepo() {
        this.projectPricingRepository = new ProjectPricingRepository(this.pool);
    }

    createPayPalRepo() {
        this.payPalRepository = new PayPalRepository(this.pool);
    }


}