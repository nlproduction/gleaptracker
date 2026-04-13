"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLinearIssue = void 0;
const sdk_1 = require("@linear/sdk");
const gleaptracker_1 = __importDefault(require("../../../gleaptracker"));
const client_1 = require("../gleap/client");
let _linear = null;
const getLinearClient = () => {
    if (!_linear) {
        _linear = new sdk_1.LinearClient({ apiKey: process.env.LINEAR_API_KEY || "" });
    }
    return _linear;
};
const createLinearIssue = async (ticket) => {
    const linear = getLinearClient();
    const cfg = gleaptracker_1.default.linear;
    const payload = await linear.createIssue({
        teamId: cfg.teamId,
        title: `[${ticket.bugId}] ${ticket.title}`,
        description: `Open in Gleap: ${(0, client_1.getGleapTicketUrl)(ticket.id, ticket.type)}`,
        labelIds: cfg.labelIds,
        stateId: cfg.stateId,
    });
    if (!payload.success)
        throw new Error(`Linear issue creation failed for ticket ${ticket.id}`);
    const issue = await payload.issue;
    if (!issue)
        throw new Error(`Linear issue not returned for ticket ${ticket.id}`);
    console.log(`[Linear] Issue created: ${issue.identifier} — ${issue.url}`);
    return { id: issue.id, url: issue.url, identifier: issue.identifier };
};
exports.createLinearIssue = createLinearIssue;
//# sourceMappingURL=client.js.map