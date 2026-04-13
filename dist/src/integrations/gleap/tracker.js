"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processTrackerTicket = void 0;
const gleaptracker_1 = __importDefault(require("../../../gleaptracker"));
const client_1 = require("../jira/client");
const client_2 = require("../linear/client");
const client_3 = require("./client");
// ---------------------------------------------------------------------------
// Dedup guards — prevent duplicate issue creation on concurrent webhooks
// ---------------------------------------------------------------------------
const creatingTrackers = new Set();
const creatingLinked = new Set();
const withDedup = async (set, id, ttlMs, fn) => {
    if (set.has(id)) {
        console.log(`[Tracker] Already processing ${id} — skipping duplicate`);
        return;
    }
    set.add(id);
    setTimeout(() => set.delete(id), ttlMs);
    await fn();
};
// ---------------------------------------------------------------------------
// Linked ticket processing
// ---------------------------------------------------------------------------
const processLinkedTickets = async (linkedTicketIds, issueIdentifier, issueUrl) => {
    const gleap = (0, client_3.getGleapClient)();
    const cfg = gleaptracker_1.default.gleap;
    await Promise.all(linkedTicketIds.map(async (ticketId) => {
        let ticket;
        try {
            ticket = await gleap.tickets.get(ticketId);
        }
        catch (e) {
            console.error(`[Tracker] Failed to fetch linked ticket ${ticketId}:`, e);
            return;
        }
        const ops = [];
        if (["OPEN", "INPROGRESS", ...cfg.onSlackStatuses].includes(ticket.status)) {
            ops.push(gleap.tickets.update(ticket.id, { status: cfg.waitingStatus }).then((ok) => {
                if (ok)
                    console.log(`[Tracker] Linked ticket ${ticket.id} → waiting status ✓`);
            }));
        }
        const formData = ticket.formData;
        if (!formData?.issueId && !creatingLinked.has(ticket.id)) {
            creatingLinked.add(ticket.id);
            setTimeout(() => creatingLinked.delete(ticket.id), 60_000);
            ops.push(gleap.messages.addNote(ticket.id, `Created issue ${issueIdentifier}\nURL: ${issueUrl}`));
            ops.push(gleap.tickets
                .update(ticket.id, {
                formData: { issueId: issueIdentifier, issueUrl },
            })
                .then((ok) => {
                if (ok)
                    console.log(`[Tracker] Linked ticket ${ticket.id} updated with issue ✓`);
            }));
        }
        try {
            await Promise.all(ops);
        }
        catch (e) {
            console.error(`[Tracker] Failed processing linked ticket ${ticket.id}:`, e);
        }
    }));
};
// ---------------------------------------------------------------------------
// Core: process a tracker ticket → create issue(s) in configured tracker(s)
// ---------------------------------------------------------------------------
const processTrackerTicket = async (ticket) => {
    const gleap = (0, client_3.getGleapClient)();
    const cfg = gleaptracker_1.default;
    if (!ticket.trackerTicket) {
        console.log(`[Tracker] Ticket ${ticket.id} skipped — not a tracker ticket`);
        return;
    }
    if (ticket.type !== cfg.gleap.trackerTicketType) {
        console.log(`[Tracker] Ticket ${ticket.id} skipped — type "${ticket.type}" is not "${cfg.gleap.trackerTicketType}"`);
        return;
    }
    await withDedup(creatingTrackers, ticket.id, 60_000, async () => {
        const useLinear = cfg.issueTracker === "linear" || cfg.issueTracker === "both";
        const useJira = cfg.issueTracker === "jira" || cfg.issueTracker === "both";
        let linearResult;
        let jiraResult;
        if (useLinear) {
            linearResult = await (0, client_2.createLinearIssue)(ticket);
            await gleap.tickets.update(ticket.id, {
                formData: {
                    linearIssueId: linearResult.identifier,
                    linearIssueUrl: linearResult.url,
                },
            });
            console.log(`[Tracker] Linear issue ${linearResult.identifier} linked to Gleap ${ticket.id}`);
        }
        if (useJira) {
            jiraResult = await (0, client_1.createJiraIssue)(ticket);
            await gleap.tickets.update(ticket.id, {
                formData: {
                    jiraIssueId: jiraResult.identifier,
                    jiraIssueUrl: jiraResult.url,
                },
            });
            console.log(`[Tracker] Jira issue ${jiraResult.identifier} linked to Gleap ${ticket.id}`);
        }
        // Use the primary tracker's identifier for linked tickets
        const primaryResult = linearResult ?? jiraResult;
        if (primaryResult && ticket.linkedTickets?.length) {
            await processLinkedTickets(ticket.linkedTickets, primaryResult.identifier, primaryResult.url);
        }
    });
};
exports.processTrackerTicket = processTrackerTicket;
//# sourceMappingURL=tracker.js.map