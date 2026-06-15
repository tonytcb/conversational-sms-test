import type { Redis } from 'ioredis';
import { ProcessInboundMessageUseCase } from './application/process-inbound-message';
import { Queries } from './application/queries';
import { ReceiveInboundSmsUseCase } from './application/receive-inbound-sms';
import type { Repositories, TransactionRunner } from './domain/ports/repositories';
import type { InboundQueue } from './domain/ports/services';
import type { Env } from './infrastructure/config/env';
import { createDb, type DbHandle } from './infrastructure/db/client';
import { buildRepositories, DrizzleTransactionRunner } from './infrastructure/db/repositories';
import { RedisLock } from './infrastructure/lock/redis-lock';
import { createLogger } from './infrastructure/observability/logger';
import { BullInboundQueue } from './infrastructure/queue/inbound-queue';
import { createRedis } from './infrastructure/redis';
import { TwilioSmsProvider } from './infrastructure/sms/twilio-provider';
import { systemClock, realSleeper } from './infrastructure/system/adapters';

const REQUEUE_DELAY_MS = 1000;
const LIST_LIMIT = 100;

// wires ports to concrete adapters; both entrypoints build from here
export interface Container {
  env: Env;
  logger: ReturnType<typeof createLogger>;
  db: DbHandle;
  repos: Repositories;
  txRunner: TransactionRunner;
  queue: BullInboundQueue;
  inboundQueue: InboundQueue;
  receiveInboundSms: ReceiveInboundSmsUseCase;
  processInbound: ProcessInboundMessageUseCase;
  queries: Queries;
  queueConnection: Redis;
  lockConnection: Redis;
  readiness: () => Promise<{ postgres: boolean; redis: boolean }>;
  close: () => Promise<void>;
}

export function createContainer(env: Env, service: string): Container {
  const logger = createLogger({ level: env.LOG_LEVEL, service, pretty: env.NODE_ENV === 'development' });

  const db = createDb(env.DATABASE_URL);
  const repos = buildRepositories(db.db);
  const txRunner = new DrizzleTransactionRunner(db.db);

  const queueConnection = createRedis(env.REDIS_URL);
  const lockConnection = createRedis(env.REDIS_URL);

  const queue = new BullInboundQueue(queueConnection, { maxAttempts: env.QUEUE_MAX_ATTEMPTS });
  const lock = new RedisLock(lockConnection);

  const sms = new TwilioSmsProvider({
    baseUrl: env.TWILIO_API_BASE_URL,
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
  });

  const receiveInboundSms = new ReceiveInboundSmsUseCase({ queue, logger });
  const processInbound = new ProcessInboundMessageUseCase({
    txRunner,
    repos,
    sms,
    lock,
    clock: systemClock,
    sleeper: realSleeper,
    logger,
    config: {
      processingMinMs: env.PROCESSING_MIN_MS,
      processingMaxMs: env.PROCESSING_MAX_MS,
      lockTtlMs: env.CONVERSATION_LOCK_TTL_MS,
      requeueDelayMs: REQUEUE_DELAY_MS,
    },
  });
  const queries = new Queries(repos);

  const readiness = async () => {
    let postgres = false;
    let redis = false;
    try {
      await db.pool.query('SELECT 1');
      postgres = true;
    } catch {
      postgres = false;
    }
    try {
      redis = (await queueConnection.ping()) === 'PONG';
    } catch {
      redis = false;
    }
    return { postgres, redis };
  };

  const close = async () => {
    await queue.close();
    await db.close();
    queueConnection.disconnect();
    lockConnection.disconnect();
  };

  return {
    env,
    logger,
    db,
    repos,
    txRunner,
    queue,
    inboundQueue: queue,
    receiveInboundSms,
    processInbound,
    queries,
    queueConnection,
    lockConnection,
    readiness,
    close,
  };
}

export const containerConstants = { LIST_LIMIT };
