import { Queue, type ConnectionOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import type { EnqueueOptions, InboundQueue } from '../../domain/ports/services';
import type { InboundSmsEvent } from '../../domain/types';

export const INBOUND_QUEUE = 'inbound-sms';
export const INBOUND_JOB = 'inbound';

export interface QueueConfig {
  maxAttempts: number;
}

export class BullInboundQueue implements InboundQueue {
  readonly queue: Queue<InboundSmsEvent>;

  constructor(connection: Redis, private readonly cfg: QueueConfig) {
    // ioredis is duplicated under bullmq's tree, so cast here (runtime is fine)
    this.queue = new Queue(INBOUND_QUEUE, {
      connection: connection as unknown as ConnectionOptions,
      defaultJobOptions: {
        attempts: cfg.maxAttempts,
        backoff: { type: 'exponential', delay: 1000 },
        // keep completed jobs ~24h so jobId dedup roughly spans Twilio's retries
        // (best-effort; the real guarantee is the DB UNIQUE(provider_sid))
        removeOnComplete: { age: 24 * 3600, count: 5000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }

  async enqueue(event: InboundSmsEvent, opts?: EnqueueOptions): Promise<void> {
    await this.queue.add(INBOUND_JOB, event, {
      jobId: opts?.jobId,
      delay: opts?.delayMs,
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
