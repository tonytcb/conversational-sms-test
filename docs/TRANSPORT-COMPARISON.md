# Queue Transport Comparison — BullMQ/Redis vs Kafka vs Google Pub/Sub

Which message transport should carry inbound SMS from the webhook to the worker? This
doc compares the three realistic options against the five hard requirements of this
system, then gives pros/cons and a recommendation.

It is the decision record behind the "ordering at scale" choice in
[`PRODUCTION-HARDENING.md`](./PRODUCTION-HARDENING.md) §B.

## The requirements

| # | Requirement | What it means here |
|---|-------------|--------------------|
| R1 | **Per-conversation ordering** | Replies leave in receive-order within a conversation; different conversations run in parallel. |
| R2 | **No requeue** | Ordering enforced by the transport, not a software lock + busy-requeue. |
| R3 | **No loss** | An accepted inbound is never dropped, even on a node crash. |
| R4 | **Exactly-once *send*** | A retried delivery never double-texts the customer (external side effect). |
| R5 | **Hot-conversation throughput** | One very active conversation does not become a throughput bottleneck. |

### The cross-cutting truth about R4

**No transport gives exactly-once to Twilio.** R4 is about an *external* side effect
(an HTTP call to a provider). Kafka's "exactly-once semantics" and Pub/Sub's
"exactly-once delivery" are **internal** to the broker — they dedup *within* the
messaging system, not on the call to Twilio. So **every** option below still needs the
same application-layer machinery we already built: persist the reply **intent** before
the send, guard with `UNIQUE(reply_to)`, and **reconcile** with the provider on an
uncertain retry (see `PRODUCTION-HARDENING.md` §A). The transport choice changes R1–R3
and R5 — **not** R4.

And the cross-cutting truth about R5: ordering and throughput are in tension on a
*single* conversation. Every option makes a hot conversation a **single ordered lane**,
so all three lean on the same mitigations — **burst coalescing** (built,
`COALESCE_BURST`) and **bounded sharding**. The transport doesn't remove that tension;
it only decides how lanes are formed and scaled.

---

## Option A — BullMQ on Redis (current stack)

A job queue on top of Redis. Open-source (OSS) BullMQ; per-key ordering is a paid
**BullMQ Pro** feature ("groups").

**How it solves the requirements**

- **R1 ordering:** OSS — via our app-layer lock + `seq` head check. **Pro groups** —
  native: one job per group (conversation) at a time, FIFO within a group.
- **R2 no requeue:** OSS — **no** (requeue is the workaround). **Pro groups — yes**,
  the queue serializes per group, so no out-of-order pickup.
- **R3 no loss:** Redis AOF (`appendonly`, fsync) persists jobs; BullMQ retries +
  stalled-job recovery re-deliver after a worker crash. Window: single-node Redis loss
  before the worker persists → closed by a transactional outbox or HA Redis (`WAIT`).
- **R4 exactly-once send:** at-least-once delivery; dedup via `jobId=MessageSid` + our
  DB constraints + reconciliation. (Same for all options.)
- **R5 hot conversation:** group = single lane; coalescing/sharding. Pro groups add
  per-group concurrency + rate limits.

**Pros**

- Already in the stack — zero new infra, lowest operational burden.
- Lowest latency (in-memory Redis), great DX, rich features: delayed jobs, exponential
  backoff, rate limiting, priorities, per-job retries, stalled recovery.
- Per-*job* model: easy delayed retries, easy to inspect/replay individual jobs.

**Cons**

- OSS has **no native per-key ordering** → you carry the lock + head check + requeue
  (what we built), or pay for **Pro** (license cost) to get groups and delete it.
- Redis durability is weaker than a replicated log: AOF fsync + Sentinel/Cluster, but
  no clean "ack only after replica" guarantee (`WAIT` is best-effort).
- Not a log — **no retention/replay** of already-consumed messages; once a job is done
  it's gone (subject to `removeOnComplete`).
- Throughput is high but below Kafka's; very large fan-out stresses a single Redis.

**Best when:** current scale, small team, want simplicity. Buy **Pro groups** to remove
the requeue without changing stacks — the smallest step to R2.

---

## Option B — Apache Kafka

A partitioned, replicated commit log. Producers write to partitions; consumers in a
group read each partition in strict offset order.

**How it solves the requirements**

- **R1 ordering:** native and **free** — `partitionKey = conversation` → all of a
  conversation's messages land on one partition, read in offset order.
- **R2 no requeue:** **yes** — a partition is consumed strictly in order by one
  consumer; no out-of-order pickup, so no lock and no requeue.
- **R3 no loss:** strongest — replication factor ≥ 3 + `acks=all` + `min.insync.replicas`
  means an accepted record survives broker loss. Durable retention (hours→forever).
- **R4 exactly-once send:** Kafka EOS (idempotent producer + transactions) is
  **internal only**; the Twilio call still needs our intent + reconciliation.
- **R5 hot conversation:** the hot key = one hot partition = single lane → same
  coalescing/sharding. Sub-partitioning a hot key trades order for throughput.

**Pros**

- **Native per-key ordering at no license cost** — directly gives R1 + R2.
- Strongest durability and the only option with **replay/retention** (reprocess
  history, rebuild state, late-joining consumers, audit).
- Highest throughput; horizontal scale via partitions + consumer groups.
- Internal exactly-once (EOS) for stream processing pipelines.

**Cons**

- **Heavy ops:** brokers, KRaft/ZooKeeper, partition planning, rebalancing — real SRE
  cost unless you use a managed Kafka (Confluent, MSK, Redpanda).
- Higher latency than Redis; tuning-sensitive.
- **Partition count caps parallelism** and is awkward to change; rebalances cause brief
  stalls. A hot partition still serializes (R5 unsolved by Kafka alone).
- **No native delayed-retry / per-message ack** — retries need extra topics
  (retry/delay topics, DLQ) and consumer-side offset management. More moving parts than
  BullMQ for simple retry/backoff.
- Operational overkill for low/medium volume.

**Best when:** very high throughput, you need **replay/audit/stream processing**, or
Kafka is already a backbone. Free ordering is the headline win.

---

## Option C — Google Cloud Pub/Sub

A fully-managed, globally-available pub/sub. **Ordering keys** give per-key in-order
delivery; **exactly-once delivery** and **dead-letter topics** are built-in features.

**How it solves the requirements**

- **R1 ordering:** native — set `orderingKey = conversation`; messages with the same
  key are delivered in publish order (enable message ordering on the subscription).
- **R2 no requeue:** **yes** — per ordering-key in-order delivery; the next message for
  a key isn't delivered until the prior is acked. No lock, no requeue.
- **R3 no loss:** managed durability + retries + **dead-letter topic** for poison
  messages; no infra to run.
- **R4 exactly-once send:** Pub/Sub "exactly-once delivery" dedups **within** Pub/Sub
  (by message id, ack-once); the Twilio call still needs our intent + reconciliation.
- **R5 hot conversation:** an ordering key is a single lane → same coalescing/sharding.

**Pros**

- **Zero ops** — fully managed, autoscaling, global. No brokers, no Redis to babysit.
- Native ordering keys (R1+R2) **and** native exactly-once delivery + DLQ — most R1–R3
  "for free" out of the box.
- Push *or* pull delivery; scales to huge fan-out without capacity planning.

**Cons**

- **Vendor lock-in (GCP)** and usage-based cost that grows with volume.
- Higher/variable latency than Redis or self-hosted Kafka.
- Ordering **reduces per-key throughput** and adds constraints (ordering + exactly-once
  together require care; same-region considerations); a hot key still serializes (R5).
- Less low-level control; no real replay/retention model like Kafka's log.
- Exactly-once delivery has caveats (dedup window, ack deadlines) and is *intra*-Pub/Sub.

**Best when:** you're on GCP and want maximum "managed," willing to trade control and
lock-in for near-zero ops. Gets you the most of R1–R3 with the least code.

---

## Side-by-side

| | **BullMQ/Redis** | **Kafka** | **Pub/Sub** |
|---|---|---|---|
| R1 per-key ordering | App lock (OSS) / native (**Pro**) | **Native, free** (partition key) | **Native** (ordering key) |
| R2 removes requeue | Only with **Pro groups** | **Yes** | **Yes** |
| R3 no loss | AOF + retries (+outbox/HA) | **Strongest** (replication, acks=all) | **Managed** + DLQ |
| R4 exactly-once *send* | App intent + reconcile | App intent + reconcile | App intent + reconcile |
| R5 hot conversation | Coalesce / shard | Coalesce / shard (+sub-partition) | Coalesce / shard |
| Delayed retry / backoff | **Native, rich** | Extra topics (DIY) | Retry policy + DLQ |
| Replay / retention | No | **Yes** | Limited |
| Latency | **Lowest** | Medium | Medium/variable |
| Ops burden | **Low** (have it) | **High** (or managed) | **Lowest** (managed) |
| Cost shape | Infra + Pro license | Infra/SRE or managed | Pay-per-use, lock-in |
| Max throughput | High | **Highest** | Very high |

## Recommendation

- **Now / this scale:** stay on **BullMQ**. To get R2 (delete the requeue) with the
  least change, buy **BullMQ Pro groups** — same stack, native per-conversation FIFO.
- **High volume + need replay/audit/streaming, or Kafka already in-house:** **Kafka** —
  free native ordering (R1+R2) and the strongest durability (R3); accept the ops cost
  (or use managed) and that hot-partition + delayed-retry are DIY.
- **All-in on GCP, optimize for zero ops:** **Pub/Sub** — native ordering keys +
  exactly-once delivery + DLQ cover R1–R3 with the least code; accept lock-in, cost,
  and less control.

**Whatever the choice, R4 (no double-text) and R5 (hot conversations) stay in our
application layer** — the intent-before-send + reconciliation (§A) and burst coalescing
/ sharding (§C) we already built. The transport decision is about R1–R3 and operational
shape, not those two.
