import TicketSetupStatus from "./TicketSetupStatus.js";
import TicketStatus from "./TicketStatus.js";

export default class Ticket {

    /**
     * @type {number}
     */
    id;
    /**
     * @type {string}
     */
    requester_discord_id;
    /**
     * @type {string}
     */
    description;
    /**
     * @type {string}
     */
    status;
    /**
     * @type {Date}
     */
    created_at;
    /**
     * @type {Date}
     */
    updated_at;
    /**
     * @type {string}
     */
    discord_channel_id;
    /**
     * @type {string}
     */
    name;
    /**
     * @type {string}
     */
    deadline;
    /**
     * @type {string}
     */
    setup_status;
    /**
     * ID of the last message sent by the bot in the discord channel
     * @type {string|null}
     */
    last_discord_message;

    constructor(requesterDiscordId) {
        this.requester_discord_id = requesterDiscordId;
        this.status = TicketStatus.Open;
        this.setup_status = TicketSetupStatus.Budgeting;
    }

    /**
     * Creates a new Ticket object from a JSON object
     * @param {Object} json Input data.
     * @returns {Ticket}
     */
    static fromJson(json) {
        if (!json) return null;

        let ticket = new Ticket();
        for (let key in json) {
            if (key === 'created_at' || key === 'updated_at') {
                ticket[key] = new Date(json[key]);
                continue;
            }
            ticket[key] = json[key];
        }
        if (!json['setup_status']) ticket.setup_status = TicketSetupStatus.Submitted;
        return ticket;
    }

}