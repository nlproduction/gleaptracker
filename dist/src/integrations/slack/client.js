"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSlackClient = void 0;
const web_api_1 = require("@slack/web-api");
let _instance = null;
const getSlackClient = () => {
    if (!_instance) {
        _instance = new web_api_1.WebClient(process.env.SLACK_BOT_TOKEN || "");
    }
    return _instance;
};
exports.getSlackClient = getSlackClient;
//# sourceMappingURL=client.js.map