"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jiraOptions = jiraOptions;
exports.jiraPost = jiraPost;
const gleaptracker_1 = __importDefault(require("../../gleaptracker"));
const client_1 = require("../integrations/gleap/client");
const recentlyProcessed = new Set();
const DEDUP_TTL_MS = 30_000;
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};
const verifySecret = (req) => {
    const secret = req.query.secret || "";
    return secret === (gleaptracker_1.default.jira.webhookSecret || "");
};
const processJiraIssueUpdate = async (payload) => {
    const { issue, changelog } = payload;
    const cfg = gleaptracker_1.default.jira;
    const statusChange = changelog?.items.find((item) => item.field === "status");
    if (!statusChange) {
        console.log(`[Jira] Issue ${issue.key} — no status change in changelog, skipping`);
        return;
    }
    if (statusChange.toString !== cfg.doneStatusName) {
        console.log(`[Jira] Issue ${issue.key} — status changed to "${statusChange.toString}", not "${cfg.doneStatusName}", skipping`);
        return;
    }
    const bugIdMatch = issue.fields.summary?.match(/^\[(\d+)\]/);
    if (!bugIdMatch) {
        console.warn(`[Jira] Issue ${issue.key} skipped — summary has no leading [bugId]: "${issue.fields.summary}"`);
        return;
    }
    const bugId = bugIdMatch[1];
    const dedupKey = `${issue.key}:${bugId}`;
    if (recentlyProcessed.has(dedupKey)) {
        console.log(`[Jira] Duplicate webhook for issue ${issue.key} — skipping`);
        return;
    }
    recentlyProcessed.add(dedupKey);
    setTimeout(() => recentlyProcessed.delete(dedupKey), DEDUP_TTL_MS);
    console.log(`[Jira] Processing done issue ${issue.key}, Gleap bugId: ${bugId}`);
    const gleap = (0, client_1.getGleapClient)();
    const { tickets } = await gleap.tickets.list({ bugId });
    const ticket = tickets[0];
    if (!ticket) {
        console.warn(`[Jira] No Gleap ticket found for bugId ${bugId}`);
        return;
    }
    const linkedTickets = (ticket.linkedTickets ?? []);
    if (linkedTickets.length) {
        await Promise.all(linkedTickets.map(async (id) => {
            const ok = await gleap.tickets.runWorkflow(id, gleaptracker_1.default.gleap.workflowId);
            if (ok)
                console.log(`[Jira] Workflow applied to Gleap ticket ${id} ✓`);
        }));
    }
    const ok = await gleap.tickets.update(ticket.id, { status: gleaptracker_1.default.gleap.doneStatus });
    if (ok)
        console.log(`[Jira] Tracker ticket ${ticket.id} marked as DONE ✓`);
};
function jiraOptions(_req, res) {
    res.set(corsHeaders).status(200).end();
}
async function jiraPost(req, res) {
    if (!verifySecret(req)) {
        res.status(401).set(corsHeaders).send("Invalid secret");
        return;
    }
    let payload;
    try {
        payload = req.body;
    }
    catch {
        res.status(400).set(corsHeaders).send("Invalid JSON");
        return;
    }
    console.log(`[Jira webhook] ${payload.webhookEvent} — issue ${payload.issue?.key}`);
    if (payload.webhookEvent !== "jira:issue_updated") {
        res.status(200).set(corsHeaders).send("Event not tracked");
        return;
    }
    try {
        await processJiraIssueUpdate(payload);
    }
    catch (e) {
        console.error("[Jira webhook] Error:", e);
        res.status(500).set(corsHeaders).json({ error: String(e) });
        return;
    }
    res.status(200).set(corsHeaders).end();
}
//# sourceMappingURL=jiraWebhook.js.map