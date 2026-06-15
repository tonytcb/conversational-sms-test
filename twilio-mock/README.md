# twilio-mock — Mountebank Twilio stub

Mocks the Twilio REST API so the system can run with **zero real Twilio credentials or cost**.
We use [Mountebank](https://www.mbtest.org/) — a ready service-virtualization tool driven by
config files, not custom code.

## What it mocks

**Outbound send** — `POST /2010-04-01/Accounts/{AccountSid}/Messages.json`
The worker calls this to "send" an SMS reply. The imposter responds `201` with a Twilio-shaped
JSON body and a **unique generated `sid`** (via an injected JS stub, so every outbound message
gets a distinct provider id — our `messages.provider_sid` is `UNIQUE`).

## Inbound SMS

Mountebank only answers outbound calls. Inbound SMS ("the customer texting in") is simulated by
[`scripts/send-sms.mjs`](../scripts/send-sms.mjs), which crafts a Twilio-form-encoded webhook,
**signs it with a valid `X-Twilio-Signature`**, and POSTs it to the API. Run it with
`make send-sms FROM=+1555... BODY="hi"`.

## How it works

- Imposter config: [`imposters/twilio.json`](./imposters/twilio.json) (loaded at start via `--configfile`).
- `recordRequests: true` keeps every received request, so you can inspect exactly what the worker
  sent: `make sent` (or `curl http://localhost:2525/imposters/4545`).
- `--allowInjection` enables the JS response stub that generates unique SIDs.

## Ports

| Port | Purpose                          |
|------|----------------------------------|
| 4545 | Twilio imposter (the mock API)   |
| 2525 | Mountebank admin / introspection |

## Why Mountebank (tradeoff)

A ready, declarative mock keeps the repo free of bespoke mock-server code and makes the contract
explicit and reviewable. The cost: it can't *originate* requests (inbound), so we pair it with the
small signing script above. Swapping in real Twilio is just changing `TWILIO_API_BASE_URL` and
credentials — no app code changes.
