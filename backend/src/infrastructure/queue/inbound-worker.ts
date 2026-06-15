import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { ProcessInboundMessageUseCase } from '../../application/process-inbound-message';
import type { InboundQueue, Logger } from '../../domain/ports/services';
import type { InboundSmsEvent } from '../../domain/types';
import { INBOUND_QUEUE } from './inbound-queue';

export interface InboundWorkerDeps {
  connection: Redis;
  concurrency: number;
  useCase: ProcessInboundMessageUseCase;
  queue: InboundQueue; // to requeue out-of-order / locked messages
  logger: Logger;
}

// thin BullMQ wrapper; only turns a `requeue` outcome into a delayed re-enqueue.
// BullMQ retry + stalled-job recovery covers crashes.
export function createInboundWorker(deps: InboundWorkerDeps): Worker<InboundSmsEvent> {
  const worker = new Worker<InboundSmsEvent>(
    INBOUND_QUEUE,
    async (job: Job<InboundSmsEvent>) => {
      const outcome = await deps.useCase.execute(job.data);
      if (outcome.kind === 'requeue') {
        await deps.queue.enqueue(job.data, {
          jobId: `${job.data.providerSid}:retry:${Date.now()}`,
          delayMs: outcome.delayMs,
        });
      }
      return outcome;
    },
    { connection: deps.connection as unknown as ConnectionOptions, concurrency: deps.concurrency },
  );

  worker.on('failed', (job, err) => {
    deps.logger.error(
      { providerSid: job?.data?.providerSid, attemptsMade: job?.attemptsMade, err: err.message },
      'job failed',
    );
  });
  worker.on('error', (err) => deps.logger.error({ err: err.message }, 'worker error'));

  return worker;
}
