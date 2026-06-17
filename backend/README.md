# backend — API + Worker (Clean Architecture)

TypeScript backend for the conversational SMS system. **One image, two
entrypoints**: the Fastify **API** (webhooks + admin REST) and the BullMQ
**worker** (async processing). Both share the same clean-architecture core, so
there is no code duplication; docker-compose runs them as independent,
independently-scalable services.

## Tools

| Concern        | Choice                                  |
|----------------|-----------------------------------------|
| HTTP           | Fastify 5 (`@fastify/formbody`, `cors`) |
| Queue          | BullMQ (Redis), durable jobs + retries; **Pro groups** partition per conversation (target) |
| DB             | Postgres + Drizzle ORM (SQL-first)      |
| Ordering       | Queue partition per conversation (target) · Redis `SET NX PX` + Lua lock (v1) |
| Validation     | Zod (env + inbound)                     |
| Observability  | pino (JSON structured logs)             |
| Tests          | Vitest (unit + integration)             |

## Architecture (dependency rule: domain ← application ← infrastructure)

```
src/
├── domain/          entities, value objects, ports (interfaces), reply generator
├── application/     use cases (orchestration only, depends on ports)
├── infrastructure/  adapters: drizzle repos, bullmq, redis lock, twilio, fastify, pino
├── composition-root.ts   manual DI — wires ports to adapters
└── entrypoints/     api.ts (Fastify) · worker.ts (BullMQ consumer)
```

The domain and application layers import **no framework** — they depend only on
the port interfaces in `domain/ports`. This is what makes the use cases trivially
unit-testable against in-memory fakes (`test/support/fakes.ts`).

## Request flow (why it scales)

- **Inbound webhook = hot path.** Parse the payload and enqueue one BullMQ job,
  then ack with empty TwiML `200`. The 5s Twilio timeout is never at risk. `jobId = MessageSid`
  drops most duplicate deliveries at the queue.
- **Worker** does the rest asynchronously: drain the conversation's **queue
  partition** (one lane per conversation → ordering with no lock/requeue), persist
  the inbound (dedup on `provider_sid`, stamp per-conversation `seq`), simulate
  3–15s, then send the reply **exactly-once** (persist intent → call Twilio with an
  idempotency key → finalize) and mark it `sent`. Every transition is recorded in
  `message_events`.
- **No loss** rests on durable Redis (AOF), BullMQ retries + stalled-job recovery,
  and idempotent reprocessing.

See [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the full rationale, and
[`docs/PRODUCTION-HARDENING.md`](../docs/PRODUCTION-HARDENING.md) for the
exactly-once / ordering / hot-conversation design this branch builds toward.

> **v1 vs target.** The committed code enforces ordering with a per-conversation
> Redis lock + head check + requeue and sends the reply *before* persisting it
> (`findReplyTo` guards re-sends). The partition + intent-before-send design above is
> documented in `docs/PRODUCTION-HARDENING.md`; divergences are flagged inline there.

## API

| Method | Path                                   | Purpose                          |
|--------|----------------------------------------|----------------------------------|
| POST   | `/webhooks/twilio/sms`                 | Inbound SMS (returns TwiML 200)  |
| GET    | `/api/v1/conversations`                | List conversation summaries      |
| GET    | `/api/v1/conversations/:id`            | Conversation + messages          |
| GET    | `/health` · `/ready`                   | Liveness · readiness            |

All `:id` path params are the **public UUID**, never the internal BIGINT.

## Run / test

```bash
npm install
npm run db:generate         # regenerate migration from schema (dev)
npm run db:migrate:dev      # apply migrations (needs DATABASE_URL)
npm run dev:api             # tsx watch
npm run dev:worker
npm test                    # unit + integration
npm run typecheck
```

Integration tests use **Testcontainers** — they spin ephemeral Postgres + Redis,
run migrations, and tear them down. No running stack needed; only a working Docker
daemon.
