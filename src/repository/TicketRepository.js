import Repository from "./Repository.js";
import Ticket from "../models/ticket/Ticket.js";
import TicketStatus from "../models/ticket/TicketStatus.js";

export default class TicketRepository extends Repository {

    /**
     * @type {[Ticket]}
     */
    tickets = [];

    constructor(pool) {
        super(pool);

        setInterval(() => this.uncacheOldTickets(), 5 * 60 * 1000);
    }

    uncacheOldTickets() {
        // remove tickets where the updated_at field is more than 15 minutes ago.
        this.tickets = this.tickets.filter(t => Date.now() - t.updated_at > 15 * 60 * 1000);
    }

    /**
     * Fetches a ticket by its Discord channel ID.
     * @param channelId Discord channel ID of the ticket.
     * @returns {Promise<Ticket>}
     */
    async fetchTicketByChannelId(channelId) {
        const cachedTicket = this.tickets.find(t => t?.discord_channel_id === channelId);
        if (cachedTicket) return cachedTicket;

        const res = await this.executeSQL("SELECT * FROM project_request_ticket WHERE discord_channel_id = ?", [channelId]);
        return this.#storeAndWrapTicket(res);
    }

    /**
     * Fetch a ticket by its ID.
     * @param id ID of the ticket.
     * @param noCache Whether to skip the cache.
     * @returns {Promise<Ticket>}
     */
    async fetchTicketById(id, noCache = false) {
        if (!noCache) {
            const cachedTicket = this.tickets.find(t => t.id === id);
            if (cachedTicket) return cachedTicket;
        }

        const res = await this.executeSQL("SELECT * FROM project_request_ticket WHERE id = ?", [id]);
        return this.#storeAndWrapTicket(res);
    }

    async hasUserOpenTicket(discordId) {
        const found = this.tickets.find(t => t.requester_discord_id === discordId);
        if (found && found.status === TicketStatus.Open) return true;

        const res = await this.executeSQL(`SELECT COUNT(*) AS amount
                                           FROM project_request_ticket
                                           WHERE requester_discord_id = ?
                                             AND status = ?`, [discordId, TicketStatus.Open]);
        return !res || (res[0]?.amount ?? 0) > 0;
    }

    /**
     * Creates a new ticket.
     * @param {Ticket} ticket Ticket to create.
     * @returns {Promise<Ticket>} Created ticket.
     */
    async createTicket(ticket) {
        const res = await this.executeSQL(`INSERT INTO project_request_ticket (requester_discord_id, discord_channel_id)
                                           VALUES (?, ?)`,
            [ticket.requester_discord_id, ticket.discord_channel_id]);

        return this.fetchTicketById(res.insertId);
    }

    /**
     * Update an existing ticket or creates a new one when not existing.
     * @param {Ticket} ticket Ticket to update.
     * @returns {Promise<Ticket>}
     */
    async updateTicket(ticket) {
        await this.executeSQL(`UPDATE project_request_ticket
                                           SET description=?,
                                               status=?,
                                               discord_channel_id=?,
                                               name=?,
                                               deadline=?,
                                               setup_status=?,
                                               last_discord_message=?,
                                               updated_at=NOW()
                                           WHERE id = ?`,
            [
                ticket.description,
                ticket.status,
                ticket.discord_channel_id,
                ticket.name,
                ticket.deadline,
                ticket.setup_status,
                ticket.last_discord_message,
                ticket.id
            ]);
        return this.fetchTicketById(ticket.id, true);
    }

    removeCachedTicket(ticket) {
        this.tickets = this.tickets.filter(t => t.id !== ticket.id);
    }

    /**
     * Caches the ticket when available and returns the wrapped object.
     * @param sqlResult SQL result object
     * @returns {Ticket}
     */
    #storeAndWrapTicket(sqlResult) {
        const ticket = Ticket.fromJson(sqlResult[0]);

        if (ticket) {
            this.tickets = this.tickets.filter(t => t.id !== ticket.id);
            this.tickets.push(ticket);
        }
        return ticket;
    }

}