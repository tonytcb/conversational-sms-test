import { createContainer } from '../composition-root';
import { loadEnv } from '../infrastructure/config/env';
import { createInboundWorker } from '../infrastructure/queue/inbound-worker';
import { createRedis } from '../infrastructure/redis';

async function main(): Promise<void> {
  const env = loadEnv();
  const c = createContainer(env, 'worker');

  // Dedicated blocking connection for the BullMQ worker.
  const workerConnection = createRedis(env.REDIS_URL);
  const worker = createInboundWorker({
    connection: workerConnection,
    concurrency: env.WORKER_CONCURRENCY,
    useCase: c.processInbound,
    queue: c.inboundQueue,
    logger: c.logger,
  });
  c.logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'worker started');

  const shutdown = async (signal: string) => {
    c.logger.info({ signal }, 'shutting down worker');
    await worker.close();
    workerConnection.disconnect();
    await c.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('worker failed to start:', err);
  process.exit(1);
});
