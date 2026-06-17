import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProcessInboundMessageUseCase } from '../../src/application/process-inbound-message';
import { Queries } from '../../src/application/queries';
import { createDb, type DbHandle } from '../../src/infrastructure/db/client';
import { buildRepositories, DrizzleTransactionRunner } from '../../src/infrastructure/db/repositories';
import { RedisLock } from '../../src/infrastructure/lock/redis-lock';
import { systemClock } from '../../src/infrastructure/system/adapters';
import { FakeSleeper, FakeSmsProvider, silentLogger } from '../support/fakes';

// real Postgres + Redis via Testcontainers (needs Docker, no running stack)
const migrationsFolder = path.resolve(process.cwd(), 'drizzle');

let pg: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let dbh: DbHandle;
let redis: IORedis;

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:16-alpine').start();
  redisContainer = await new RedisContainer('redis:7-alpine').start();

  dbh = createDb(pg.getConnectionUri());
  await migrate(dbh.db, { migrationsFolder });
  redis = new IORedis(redisContainer.getConnectionUrl(), { maxRetriesPerRequest: null });
}, 120_000);

afterAll(async () => {
  await dbh?.close().catch(() => {});
  redis?.disconnect();
  await pg?.stop();
  await redisContainer?.stop();
});

beforeEach(async () => {
  await dbh.pool.query('TRUNCATE message_events, messages, conversations RESTART IDENTITY CASCADE');
});

function buildUseCase() {
  const repos = buildRepositories(dbh.db);
  const txRunner = new DrizzleTransactionRunner(dbh.db);
  const uc = new ProcessInboundMessageUseCase({
    txRunner,
    repos,
    sms: new FakeSmsProvider(),
    lock: new RedisLock(redis),
    clock: systemClock,
    sleeper: new FakeSleeper(),
    logger: silentLogger,
    config: { processingMinMs: 0, processingMaxMs: 0, lockTtlMs: 30000, requeueDelayMs: 500 },
  });
  return { uc, repos, queries: new Queries(repos) };
}

const event = (overrides = {}) => ({
  providerSid: 'SMint1',
  from: '+15557770001',
  to: '+15550000000',
  body: 'integration hello',
  receivedAt: new Date().toISOString(),
  ...overrides,
});

describe('end-to-end flow against real Postgres + Redis', () => {
  it('persists inbound + outbound and the full audit trail', async () => {
    const { uc, queries } = buildUseCase();

    const out = await uc.execute(event());
    expect(out.kind).toBe('processed');

    const list = await queries.listConversations({ limit: 10 });
    expect(list).toHaveLength(1);
    const detail = await queries.getConversation(list[0]!.id);
    expect(detail.messages.map((m) => m.direction)).toEqual(['inbound', 'outbound']);
    expect(detail.messages.every((m) => m.status === 'sent')).toBe(true);

    const inbound = detail.messages.find((m) => m.direction === 'inbound')!;
    const { rows } = await dbh.pool.query(
      `SELECT e.to_status FROM message_events e
       JOIN messages m ON m.id = e.message_id
       WHERE m.public_id = $1 ORDER BY e.occurred_at, e.id`,
      [inbound.id],
    );
    expect(rows.map((r) => r.to_status)).toEqual(['received', 'processing', 'sent']);
  });

  it('deduplicates a redelivered MessageSid (unique provider_sid)', async () => {
    const { uc, repos } = buildUseCase();
    await uc.execute(event());
    const second = await uc.execute(event()); // same SID
    expect(second.kind).toBe('duplicate');
    const rows = await repos.messages.listByConversationId(1);
    expect(rows).toHaveLength(2);
  });

  it('persists the outbound reply with provider_sid and idempotency key (exactly-once send)', async () => {
    const { uc } = buildUseCase();
    await uc.execute(event({ providerSid: 'SMidem' }));

    const { rows } = await dbh.pool.query(
      "SELECT status, provider_sid, idempotency_key FROM messages WHERE direction = 'outbound'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('sent');
    expect(rows[0].provider_sid).toMatch(/^SMout/);
    expect(rows[0].idempotency_key).toMatch(/^reply:/);
  });

  it('reply intent is idempotent under concurrency — exactly one outbound row (UNIQUE reply_to)', async () => {
    const { repos } = buildUseCase();
    const now = new Date();
    const conv = await repos.conversations.upsert({
      participantPhone: '+15557770002',
      businessPhone: '+15550000000',
      now,
    });
    const { message: inbound } = await repos.messages.insertDedup({
      conversationId: conv.id,
      direction: 'inbound',
      providerSid: 'SMrace1',
      body: 'hi',
      status: 'processing',
      now,
    });
    const key = `reply:${inbound.id}`;

    // two workers race to claim the reply for the same inbound
    const results = await Promise.all([
      repos.messages.insertReplyIntent({ conversationId: conv.id, replyToMessageId: inbound.id, idempotencyKey: key, body: 'r', now }),
      repos.messages.insertReplyIntent({ conversationId: conv.id, replyToMessageId: inbound.id, idempotencyKey: key, body: 'r', now }),
    ]);

    expect(results.filter((r) => r.inserted)).toHaveLength(1); // exactly one winner
    const { rows } = await dbh.pool.query(
      "SELECT count(*)::int AS n FROM messages WHERE direction = 'outbound' AND reply_to_message_id = $1",
      [inbound.id],
    );
    expect(rows[0].n).toBe(1);
  });

  it('returns conversation messages in chronological order', async () => {
    const { uc, repos } = buildUseCase();
    await uc.execute(event({ providerSid: 'SMseqA', body: 'first' }));
    await uc.execute(event({ providerSid: 'SMseqB', body: 'second' }));
    const rows = await repos.messages.listByConversationId(1);
    expect(rows.map((r) => r.direction)).toEqual(['inbound', 'outbound', 'inbound', 'outbound']);
    expect(rows.map((r) => r.body)).toEqual([
      'first',
      expect.stringContaining('first'),
      'second',
      expect.stringContaining('second'),
    ]);
  });
});
