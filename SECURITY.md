# Security

## Reporting a vulnerability

Do not publish credentials, customer conversations, or a working exploit against a live installation in a GitHub issue. Contact the [MapSVG team](https://mapsvg.com) through the website's support channel and identify the report as a GleapTracker security issue. Include the affected revision and a minimal reproduction using dummy data.

## Deployment checklist

Use HTTPS, least-privilege provider credentials, a private `.env.local`, and one service instance. Protect the Gleap webhook with a configured shared secret or trusted reverse-proxy ingress; compatibility mode without a secret is not authenticated. Slack, GitHub, Linear, and native Jira signatures require the original request body.

Prefer signed Jira webhooks over query-secret URLs. The application excludes query strings from access logs, but your reverse proxy and hosting platform may still record them. Configure redaction there too. Rotate any credential or shared secret that appears in logs, commits, screenshots, or public tickets.

The service processes customer data and sends parts of it to the workspaces you configure. Limit access to the Slack channel and engineering projects, and test customer-notification workflows in staging. Do not copy production support payloads into test fixtures.

## Reliability boundaries

In-process locks and stored Gleap fields reduce duplicate processing but are not distributed transactions. Crashes and partial API failures can require manual reconciliation. Keep monitoring and provider webhook delivery logs available, and avoid automatically replaying uncertain customer-notification operations without reviewing their effects.
