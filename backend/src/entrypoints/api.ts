import { createContainer, containerConstants } from '../composition-root';
import { loadEnv } from '../infrastructure/config/env';
import { buildServer } from '../infrastructure/http/server';

async function main(): Promise<void> {
  const env = loadEnv();
  const c = createContainer(env, 'api');

  const app = buildServer({
    logger: c.logger,
    receiveInboundSms: c.receiveInboundSms,
    queries: c.queries,
    readiness: c.readiness,
    config: {
      listLimit: containerConstants.LIST_LIMIT,
    },
  });

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  c.logger.info({ port: env.API_PORT }, 'api listening');

  const shutdown = async (signal: string) => {
    c.logger.info({ signal }, 'shutting down api');
    await app.close();
    await c.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('api failed to start:', err);
  process.exit(1);
});
