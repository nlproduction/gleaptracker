"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.linearOptions = linearOptions;
exports.linearPost = linearPost;
const crypto_1 = __importDefault(require("crypto"));
const gleaptracker_1 = __importDefault(require("../../gleaptracker"));
const client_1 = require("../integrations/gleap/client");
const recentlyProcessed = new Set();
const DEDUP_TTL_MS = 30_000;
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, linear-signature",
};
const verifySignature = (headerSignature, rawBody) => {
    if (!headerSignature)
        return false;
    const secret = gleaptracker_1.default.linear.webhookSecret;
    const headerBuf = new Uint8Array(Buffer.from(headerSignature, "hex"));
    const computed = new Uint8Array(crypto_1.default.createHmac("sha256", secret).update(rawBody).digest());
    return crypto_1.default.timingSafeEqual(computed, headerBuf);
};
const processIssueUpdate = async (data) => {
    const issue = data;
    const cfg = gleaptracker_1.default.linear;
    const hasTrackerLabel = issue.labels?.some((l) => l.name.toLowerCase() === cfg.trackerLabel.toLowerCase());
    if (!hasTrackerLabel) {
        console.log(`[Linear] Issue ${issue.id} skipped — missing label "${cfg.trackerLabel}"`);
        return;
    }
    if (issue.state?.type !== "completed") {
        console.log(`[Linear] Issue ${issue.id} skipped — state type "${issue.state?.type}" is not completed`);
        return;
    }
    const bugIdMatch = issue.title?.match(/^\[(\d+)\]/);
    if (!bugIdMatch) {
        console.warn(`[Linear] Issue ${issue.id} skipped — title has no leading [bugId]: "${issue.title}"`);
        return;
    }
    const bugId = bugIdMatch[1];
    const dedupKey = `${issue.id}:${bugId}`;
    if (recentlyProcessed.has(dedupKey)) {
        console.log(`[Linear] Duplicate webhook for issue ${issue.id} — skipping`);
        return;
    }
    recentlyProcessed.add(dedupKey);
    setTimeout(() => recentlyProcessed.delete(dedupKey), DEDUP_TTL_MS);
    console.log(`[Linear] Processing done issue ${issue.id}, Gleap bugId: ${bugId}`);
    const gleap = (0, client_1.getGleapClient)();
    const { tickets } = await gleap.tickets.list({ bugId });
    const ticket = tickets[0];
    if (!ticket) {
        console.warn(`[Linear] No Gleap ticket found for bugId ${bugId}`);
        return;
    }
    const linkedTickets = (ticket.linkedTickets ?? []);
    if (linkedTickets.length) {
        await Promise.all(linkedTickets.map(async (id) => {
            const ok = await gleap.tickets.runWorkflow(id, gleaptracker_1.default.gleap.workflowId);
            if (ok)
                console.log(`[Linear] Workflow applied to ticket ${id} ✓`);
        }));
    }
    const ok = await gleap.tickets.update(ticket.id, { status: gleaptracker_1.default.gleap.doneStatus });
    if (ok)
        console.log(`[Linear] Tracker ticket ${ticket.id} marked as DONE ✓`);
};
function linearOptions(_req, res) {
    res.set(corsHeaders).status(200).end();
}
function rawBodyToString(body) {
    if (Buffer.isBuffer(body))
        return body.toString("utf8");
    if (typeof body === "string")
        return body;
    return "";
}
async function linearPost(req, res) {
    const rawBody = rawBodyToString(req.body);
    const signature = req.get("linear-signature") || "";
    if (!verifySignature(signature, rawBody)) {
        res.status(401).set(corsHeaders).send("Invalid signature");
        return;
    }
    let payload;
    try {
        payload = JSON.parse(rawBody);
    }
    catch {
        res.status(400).set(corsHeaders).send("Invalid JSON");
        return;
    }
    const { type, action, data } = payload;
    if (type !== "Issue" || action !== "update") {
        res.status(200).set(corsHeaders).send("Event not tracked");
        return;
    }
    try {
        await processIssueUpdate(data);
    }
    catch (e) {
        console.error("[Linear webhook] Error:", e);
        res.status(500).set(corsHeaders).json({ error: String(e) });
        return;
    }
    res.status(200).set(corsHeaders).end();
}
//# sourceMappingURL=linearWebhook.js.map