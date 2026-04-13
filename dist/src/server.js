"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const morgan_1 = __importDefault(require("morgan"));
const gleapWebhook_1 = require("./handlers/gleapWebhook");
const jiraWebhook_1 = require("./handlers/jiraWebhook");
const linearWebhook_1 = require("./handlers/linearWebhook");
const slack_1 = require("./handlers/slack");
dotenv_1.default.config({ path: ".env.local" });
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = Number(process.env.PORT) || 3000;
app.use((0, morgan_1.default)("combined"));
app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "gleaptracker" });
});
const rawBody = express_1.default.raw({ type: "*/*", limit: "5mb" });
const jsonBody = express_1.default.json({ limit: "2mb" });
app.options("/api/slack", slack_1.slackOptions);
app.post("/api/slack", rawBody, (req, res) => void (0, slack_1.slackPost)(req, res));
app.options("/api/webhooks/linear", linearWebhook_1.linearOptions);
app.post("/api/webhooks/linear", rawBody, (req, res) => void (0, linearWebhook_1.linearPost)(req, res));
app.options("/api/webhooks/gleap", gleapWebhook_1.gleapOptions);
app.post("/api/webhooks/gleap", jsonBody, (req, res) => void (0, gleapWebhook_1.gleapPost)(req, res));
app.options("/api/webhooks/jira", jiraWebhook_1.jiraOptions);
app.post("/api/webhooks/jira", jsonBody, (req, res) => void (0, jiraWebhook_1.jiraPost)(req, res));
app.listen(PORT, () => {
    console.log(`GleapTracker listening on http://localhost:${PORT}`);
});
//# sourceMappingURL=server.js.map