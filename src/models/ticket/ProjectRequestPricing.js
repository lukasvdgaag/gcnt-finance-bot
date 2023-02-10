import {uuid} from "uuidv4";

export default class ProjectRequestPricing{

    /**
     * @type {string}
     */
    id;
    /**
     * @type {string}
     */
    token;
    /**
     * @type {string}
     */
    selections;
    /**
     * @type {boolean}
     */
    allow_publications;
    /**
     * @type {number}
     */
    ticket;
    /**
     * @type {Date}
     */
    date;
    /**
     * @type {boolean}
     */
    updated;

    constructor(ticketId) {
        this.ticket = ticketId;
        this.date = new Date();
        this.updated = false;

        this.id = uuid();
        this.token = uuid();
    }

    static fromJson(json) {
        if (!json) return null;
        const obj = new ProjectRequestPricing();

        for (const key in json) {
            if (key === 'allow_publications' || key === 'updated') {
                obj[key] = json[key] === 1;
                continue;
            } else if (key === 'ticket') {
                obj[key] = parseInt(json[key]);
                continue;
            } else if (key === 'date') {
                obj[key] = new Date(json[key]);
                continue;
            }
            obj[key] = json[key];
        }
        return obj;
    }

}