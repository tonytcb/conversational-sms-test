import { z } from 'zod';

// validated env — fail fast at boot
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_FROM_NUMBER: z.string().min(1),
  TWILIO_API_BASE_URL: z.string().url(),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  PROCESSING_MIN_MS: z.coerce.number().int().nonnegative().default(3000),
  PROCESSING_MAX_MS: z.coerce.number().int().positive().default(15000),
  QUEUE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  CONVERSATION_LOCK_TTL_MS: z.coerce.number().int().positive().default(30000),
  // hot-conversation throughput: answer a conversation's pending inbound burst with one reply
  COALESCE_BURST: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.PROCESSING_MIN_MS > parsed.data.PROCESSING_MAX_MS) {
    throw new Error('PROCESSING_MIN_MS must be <= PROCESSING_MAX_MS');
  }
  cached = parsed.data;
  return cached;
}
