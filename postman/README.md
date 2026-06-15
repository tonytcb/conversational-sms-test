# Postman collection

`sms-system.postman_collection.json` — all API, webhook and admin requests for the
SMS system, ready to import.

## Import

Postman → **Import** → drop the JSON file. It self-contains its variables (no
separate environment needed).

## Configure (Collection → Variables)

| Variable      | Default                                          | Notes |
|---------------|--------------------------------------------------|-------|
| `baseUrl`     | `http://localhost:3000`                          | API host. If you remapped the host port (`API_HOST_PORT=3001`), set `http://localhost:3001`. |
| `from` / `to` / `body` | sample values                          | Inbound message fields. |

## Suggested flow

1. **Twilio Webhooks → Inbound SMS** — a pre-request script generates a fresh
   `MessageSid`. Returns empty TwiML `200` immediately; processing runs async (3–15s).
2. Wait a few seconds, then **Admin API → List conversations** (captures
   `conversationId`).
3. **Get conversation** — see the inbound + the reply with their status.

`Health & Ops` has `/health` and `/ready`.

