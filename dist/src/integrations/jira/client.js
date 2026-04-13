"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createJiraIssue = void 0;
const gleaptracker_1 = __importDefault(require("../../../gleaptracker"));
const client_1 = require("../gleap/client");
const getAuthHeader = () => {
    const email = process.env.JIRA_EMAIL || "";
    const token = process.env.JIRA_API_TOKEN || "";
    return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
};
const getBaseUrl = () => {
    const host = gleaptracker_1.default.jira.host;
    return `https://${host}/rest/api/3`;
};
const createJiraIssue = async (ticket) => {
    const cfg = gleaptracker_1.default.jira;
    const gleapUrl = (0, client_1.getGleapTicketUrl)(ticket.id, ticket.type);
    const body = {
        fields: {
            project: { key: cfg.projectKey },
            summary: `[${ticket.bugId}] ${ticket.title}`,
            description: {
                type: "doc",
                version: 1,
                content: [
                    {
                        type: "paragraph",
                        content: [
                            { type: "text", text: "Open in Gleap: " },
                            {
                                type: "text",
                                text: gleapUrl,
                                marks: [{ type: "link", attrs: { href: gleapUrl } }],
                            },
                        ],
                    },
                ],
            },
            issuetype: { name: cfg.issueType },
        },
    };
    const res = await fetch(`${getBaseUrl()}/issue`, {
        method: "POST",
        headers: {
            Authorization: getAuthHeader(),
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`[Jira] POST issue failed: ${res.status} ${text}`);
    }
    const data = (await res.json());
    const url = `https://${cfg.host}/browse/${data.key}`;
    console.log(`[Jira] Issue created: ${data.key} — ${url}`);
    return { id: data.id, key: data.key, url, identifier: data.key };
};
exports.createJiraIssue = createJiraIssue;
//# sourceMappingURL=client.js.map