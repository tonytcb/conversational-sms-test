import { setTimeout as sleepMs } from 'node:timers/promises';
import type { Clock, Sleeper } from '../../domain/ports/services';

export const systemClock: Clock = {
  now: () => new Date(),
};

export const realSleeper: Sleeper = {
  sleep: (ms) => sleepMs(ms),
};
