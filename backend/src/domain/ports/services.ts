import type { InboundSmsEvent } from '../types';

export interface SmsProvider {
  // idempotencyKey lets the provider dedup retried sends so a crash mid-send can't double-text
  send(input: {
    to: string;
    from: string;
    body: string;
    idempotencyKey: string;
  }): Promise<{ providerSid: string; status: string }>;
}

export interface EnqueueOptions {
  jobId?: string; // = providerSid, dedups at the queue
  delayMs?: number; // used to requeue out-of-order messages
}

export interface InboundQueue {
  enqueue(event: InboundSmsEvent, opts?: EnqueueOptions): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface Sleeper {
  sleep(ms: number): Promise<void>;
}

export interface LockHandle {
  release(): Promise<void>;
}

export interface DistributedLock {
  // null if already held
  acquire(key: string, ttlMs: number): Promise<LockHandle | null>;
}

// logger port keeps domain/app off pino directly
export interface Logger {
  child(bindings: Record<string, unknown>): Logger;
  debug(obj: Record<string, unknown> | string, msg?: string): void;
  info(obj: Record<string, unknown> | string, msg?: string): void;
  warn(obj: Record<string, unknown> | string, msg?: string): void;
  error(obj: Record<string, unknown> | string, msg?: string): void;
}
