import Repository from "./Repository.js";
import Ticket from "../models/ticket/Ticket.js";
import TicketStatus from "../models/ticket/TicketStatus.js";

export default class TicketRepository extends Repository {

    static shared = new TicketRepository();

    /**
     * @type {[Ticket]}
     */
    tickets = [];

    /**
     * Fetches a ticket by its Discord channel ID.
     * @param channelId Discord channel ID of the ticket.
     * @returns {Promise<Ticket>}
     */
    async fetchTicketByChannelId(channelId) {
        const cachedTicket = this.tickets.find(t => t.discord_channel_id === channelId);
        if (cachedTicket) return cachedTicket;

        const res = await this.executeSQL("SELECT * FROM plugin_request_ticket WHERE discord_channel_id = ?", [channelId]);
        return this.#storeAndWrapTicket(res);
    }

    /**
     * Fetch a ticket by its ID.
     * @param id ID of the ticket.
     * @returns {Promise<Ticket>}
     */
    async fetchTicketById(id) {
        const cachedTicket = this.tickets.find(t => t.id === id);
        if (cachedTicket) return cachedTicket;

        const res = await this.executeSQL("SELECT * FROM plugin_request_ticket WHERE id = ?", [id]);
        return this.#storeAndWrapTicket(res);
    }

    async hasUserOpenTicket(discordId) {
        if (this.tickets.find(t => t.requester_discord_id === discordId)) return true;

        const res = await this.executeSQL(`SELECT COUNT(*) AS amount FROM plugin_request_ticket 
                          WHERE requester_discord_id = ? AND status = ${TicketStatus.Open}`, [discordId]);
        return !res || (res[0]?.amount ?? 0) > 0;
    }

    /**
     * Caches the ticket when available and returns the wrapped object.
     * @param sqlResult SQL result object
     * @returns {Ticket}
     */
    #storeAndWrapTicket(sqlResult) {
        const ticket = Ticket.fromJson(sqlResult[0]);

        if (ticket) this.tickets[ticket.id] = ticket;
        return ticket;
    }

}