"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGleapClient = exports.GleapClient = exports.getGleapTicketUrl = void 0;
const gleaptracker_1 = __importDefault(require("../../../gleaptracker"));
const BASE_URL = "https://api.gleap.io/v3";
const APP_BASE = "https://app.gleap.io/projects";
const TYPE_PATH = {
    BUG: "bugs",
    INQUIRY: "inquiries",
};
const getGleapTicketUrl = (ticketId, ticketType) => {
    const projectId = gleaptracker_1.default.gleap.projectId;
    const segment = ticketType ? (TYPE_PATH[ticketType] ?? ticketType.toLowerCase()) : "tickets";
    return `${APP_BASE}/${projectId}/${segment}/${ticketId}`;
};
exports.getGleapTicketUrl = getGleapTicketUrl;
// ---------------------------------------------------------------------------
// Tickets resource
// ---------------------------------------------------------------------------
class GleapTicketsResource {
    headers;
    constructor(headers) {
        this.headers = headers;
    }
    async get(ticketId) {
        const res = await fetch(`${BASE_URL}/tickets/${ticketId}`, { headers: this.headers });
        if (!res.ok)
            throw new Error(`[Gleap] GET ticket ${ticketId} failed: ${res.status}`);
        return (await res.json());
    }
    async list(params = {}) {
        const query = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))).toString();
        const url = `${BASE_URL}/tickets${query ? `?${query}` : ""}`;
        const res = await fetch(url, { headers: this.headers });
        if (!res.ok)
            throw new Error(`[Gleap] GET tickets failed: ${res.status}`);
        return (await res.json());
    }
    async create(data) {
        const res = await fetch(`${BASE_URL}/tickets`, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify(data),
        });
        if (!res.ok)
            throw new Error(`[Gleap] POST ticket failed: ${res.status} ${await res.text()}`);
        return (await res.json());
    }
    async createTracker(data) {
        const res = await fetch(`${BASE_URL}/tickets/tracker-tickets`, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify(data),
        });
        if (!res.ok)
            throw new Error(`[Gleap] POST tracker ticket failed: ${res.status} ${await res.text()}`);
        return (await res.json());
    }
    async update(ticketId, data) {
        const res = await fetch(`${BASE_URL}/tickets/${ticketId}`, {
            method: "PUT",
            headers: this.headers,
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            console.error(`[Gleap] PUT ticket ${ticketId} failed: ${res.status} ${await res.text()}`);
        }
        return res.ok;
    }
    async runWorkflow(ticketId, workflowId) {
        const res = await fetch(`${BASE_URL}/tickets/${ticketId}/workflow`, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify({ workflowId }),
        });
        if (!res.ok) {
            console.error(`[Gleap] Workflow ${workflowId} on ticket ${ticketId} failed: ${res.status} ${await res.text()}`);
        }
        return res.ok;
    }
}
// ---------------------------------------------------------------------------
// Messages resource
// ---------------------------------------------------------------------------
class GleapMessagesResource {
    headers;
    constructor(headers) {
        this.headers = headers;
    }
    async addNote(ticketId, text) {
        const res = await fetch(`${BASE_URL}/messages`, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify({
                ticket: ticketId,
                type: "NOTE",
                isNote: true,
                bot: false,
                comment: { type: "paragraph", content: [{ type: "text", text }] },
            }),
        });
        if (!res.ok) {
            console.error(`[Gleap] addNote on ticket ${ticketId} failed: ${res.status} ${await res.text()}`);
        }
    }
}
// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
class GleapClient {
    tickets;
    messages;
    constructor(apiKey, projectId) {
        const headers = {
            project: projectId,
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        };
        this.tickets = new GleapTicketsResource(headers);
        this.messages = new GleapMessagesResource(headers);
    }
}
exports.GleapClient = GleapClient;
let _instance = null;
const getGleapClient = () => {
    if (!_instance) {
        _instance = new GleapClient(process.env.GLEAP_API_KEY || "", gleaptracker_1.default.gleap.projectId);
    }
    return _instance;
};
exports.getGleapClient = getGleapClient;
//# sourceMappingURL=client.js.map