# SMS Messaging System

A conversational SMS system: a customer texts in, the backend processes the
message asynchronously (3–15s) and replies via SMS, and an admin web UI shows the
conversation histories with live message status.

Built around one hard constraint — **Twilio's webhook times out at 5s but
processing takes 3–15s** — so ingest and processing are fully decoupled, with
idempotency, ordering, and no message loss. Full rationale in
**[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**.

## Stack

React + TypeScript · Fastify · Postgres (Drizzle) · Redis (BullMQ) · clean
architecture · Docker Compose · Mountebank (Twilio mock) · Vitest + Playwright.

## How it works (1 minute)

```mermaid
flowchart LR
  C((Customer)) --> Tw[Twilio]
  Tw -- "signed webhook" --> API
  API -- "enqueue\njobId=MessageSid\npartitioned by conversation" --> Redis[("Redis / BullMQ")]
  Redis --> Worker
  Worker -- "reply" --> MB[Mountebank\nTwilio mock]
  Worker <--> PG[("Postgres")]
  API --> PG
  UI[/React Admin/] --> API
```

- **API hot path** = parse + one Redis enqueue + ack (empty TwiML `200`). No DB →
  the 5s budget is never at risk.
- **Worker** persists (dedup on `provider_sid` + per-conversation `seq`), simulates
  3–15s, generates and **sends the reply exactly-once** (persist intent before the
  call + idempotency key), and records every status transition.
- **Idempotency**: queue jobId + unique `provider_sid` (receive); intent row +
  `idempotency_key` + unique `reply_to_message_id` (send, exactly-once). **No loss**
  via durable Redis (AOF) + BullMQ retries/stalled-job recovery. **Ordering** via a
  per-conversation **queue partition** (one lane per conversation, no requeue).
- **Hot conversations** keep order *and* throughput: cheap ordered ingest (`seq`)
  is split from heavy parallel processing, replies re-ordered on send.

> The exactly-once send, queue partitioning, and hot-conversation scaling are the
> production design documented in **[docs/PRODUCTION-HARDENING.md](./docs/PRODUCTION-HARDENING.md)**;
> the v1 code still uses a Redis lock + head check + requeue (called out inline in the docs).

## Repository layout

```
backend/      Fastify API + BullMQ worker (one image, two entrypoints), clean arch
frontend/     React + Vite admin UI (nginx)
twilio-mock/  Mountebank imposter for the Twilio Messages API
e2e/          Playwright end-to-end tests
scripts/      send-sms.mjs — signed inbound-SMS simulator
docs/         ARCHITECTURE.md (design + diagrams)
docker-compose.yml · Makefile · .env.example
```

Each service has its own `README.md` and Docker config and is independently
deployable.

## Run it

```bash
make up                 # build + start the whole stack (creates .env from .env.example)
make migrate            # apply DB migrations (also runs automatically on boot)
```

| Service           | URL                              |
|-------------------|----------------------------------|
| Admin UI          | http://localhost:8080            |
| API               | http://localhost:3000 (`/health`, `/ready`) |
| Mountebank admin  | http://localhost:2525            |

> If host ports 3000/5432/6379 are busy, override `API_HOST_PORT`,
> `POSTGRES_PORT`, `REDIS_PORT` in `.env`.

### Try the round trip

```bash
make send-sms FROM=+15551112222 BODY="hello there"   # simulate a customer SMS
make logs-worker                                     # watch received -> processing -> sent
make sent                                            # what the worker sent to the Twilio mock
```

Then open the Admin UI — the conversation appears and the reply's status moves to
`sent` live.

## Test

```bash
make test     # backend unit + integration (real Postgres + Redis when up)
make e2e      # Playwright e2e against the running stack
```

## Key endpoints

```
POST /webhooks/twilio/sms            inbound (returns empty TwiML 200)
GET  /api/v1/conversations           list
GET  /api/v1/conversations/:id       conversation + messages
GET  /health · /ready                liveness · readiness
```
