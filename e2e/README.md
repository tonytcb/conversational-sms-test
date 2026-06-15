# e2e — Playwright end-to-end tests

Drives the **real frontend** against the **full running stack** (compose), so it
exercises the whole path: Twilio webhook → API → queue → worker → Mountebank →
Postgres → admin UI.

## Tools

- **Playwright** (`@playwright/test`) — browser automation + an API request
  context used to POST the inbound webhook (simulating the customer).

## What it covers

1. `inbound SMS appears … and receives a sent reply` — full round trip rendered
   in the UI, asserting the outbound reply and its `sent`/`delivered` badge.
2. `duplicate inbound delivery …` — sends the same `MessageSid` twice and asserts
   exactly one inbound message (idempotency, observed end-to-end).

## Run

```bash
# stack must be up first (from repo root): make up
cd e2e
npm install
npm run install:browsers   # one-time: playwright install chromium
npm test
```

Configurable via env (defaults in parentheses):

| Var        | Default                 | Meaning                       |
|------------|-------------------------|-------------------------------|
| `BASE_URL` | `http://localhost:8080` | Frontend URL                  |
| `API_URL`  | `http://localhost:3001` | API host URL (webhook target) |
