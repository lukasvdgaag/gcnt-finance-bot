import Repository from "./Repository.js";
import ProjectRequestPricing from "../models/ticket/ProjectRequestPricing.js";
import {v4 as uuid} from "uuid";

export default class ProjectPricingRepository extends Repository {

    static shared = new ProjectPricingRepository();

    /**
     * Creates a new project pricing.
     * @param {Ticket} ticket
     * @returns {Promise<ProjectRequestPricing>}
     */
    async createProjectPricing(ticket) {
        await this.executeSQL(`INSERT INTO project_request_pricing (id, token, ticket) VALUES (?, ?, ?)`,
            [uuid(), uuid(), ticket.id])

        return await this.fetchProjectPricingByTicketId(ticket.id);
    }

    /**
     * Fetches the project pricing by ticket ID.
     * @param ticketId
     * @returns {Promise<ProjectRequestPricing>}
     */
    async fetchProjectPricingByTicketId(ticketId) {
        const res = await this.executeSQL(`SELECT * FROM project_request_pricing WHERE ticket = ?`, [ticketId]);
        return ProjectRequestPricing.fromJson(res[0]);
    }

}