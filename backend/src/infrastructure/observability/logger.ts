import pino, { type Logger as PinoLogger } from 'pino';
import type { Logger } from '../../domain/ports/services';

/** Adapts pino to the domain Logger port. */
class PinoAdapter implements Logger {
  constructor(private readonly l: PinoLogger) {}
  child(bindings: Record<string, unknown>): Logger {
    return new PinoAdapter(this.l.child(bindings));
  }
  debug(obj: Record<string, unknown> | string, msg?: string): void {
    typeof obj === 'string' ? this.l.debug(obj) : this.l.debug(obj, msg);
  }
  info(obj: Record<string, unknown> | string, msg?: string): void {
    typeof obj === 'string' ? this.l.info(obj) : this.l.info(obj, msg);
  }
  warn(obj: Record<string, unknown> | string, msg?: string): void {
    typeof obj === 'string' ? this.l.warn(obj) : this.l.warn(obj, msg);
  }
  error(obj: Record<string, unknown> | string, msg?: string): void {
    typeof obj === 'string' ? this.l.error(obj) : this.l.error(obj, msg);
  }
}

export function createLogger(opts: { level: string; service: string; pretty: boolean }): Logger {
  const base = pino({
    level: opts.level,
    base: { service: opts.service },
    transport: opts.pretty ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  });
  return new PinoAdapter(base);
}
