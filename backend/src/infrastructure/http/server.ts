import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ReceiveInboundSmsUseCase } from '../../application/receive-inbound-sms';
import type { Queries } from '../../application/queries';
import { InvalidInboundEventError, NotFoundError } from '../../domain/errors';
import type { Logger } from '../../domain/ports/services';

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export interface ServerDeps {
  logger: Logger;
  receiveInboundSms: ReceiveInboundSmsUseCase;
  queries: Queries;
  readiness: () => Promise<{ postgres: boolean; redis: boolean }>;
  config: {
    listLimit: number;
  };
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  // Admin UI is served from a different origin (browser -> API); allow it.
  app.register(cors, { origin: true });
  app.register(formbody);

  // ---- Health / readiness ----
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async (_req, reply) => {
    const r = await deps.readiness();
    const ready = r.postgres && r.redis;
    return reply.code(ready ? 200 : 503).send({ ready, ...r });
  });

  // ---- Twilio inbound webhook (HOT PATH) ----
  app.post('/webhooks/twilio/sms', async (req, reply) => {
    const params = (req.body ?? {}) as Record<string, string>;

    await deps.receiveInboundSms.execute({
      providerSid: params.MessageSid ?? '',
      from: params.From ?? '',
      to: params.To ?? '',
      body: params.Body ?? '',
      receivedAt: new Date().toISOString(),
    });

    // Twilio expects TwiML; empty <Response/> = ack with no inline reply (we reply async).
    reply.header('Content-Type', 'text/xml');
    return EMPTY_TWIML;
  });

  // ---- Admin API (versioned) ----
  app.get('/api/v1/conversations', async () => {
    const conversations = await deps.queries.listConversations({ limit: deps.config.listLimit });
    return { conversations };
  });

  app.get<{ Params: { id: string } }>('/api/v1/conversations/:id', async (req) => {
    return deps.queries.getConversation(req.params.id);
  });

  // ---- Error mapping ----
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    if (err instanceof InvalidInboundEventError) return reply.code(400).send({ error: err.message });
    const e = err as Error;
    deps.logger.error({ err: e.message, stack: e.stack }, 'unhandled error');
    return reply.code(500).send({ error: 'internal_error' });
  });

  return app;
}
