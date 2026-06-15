import IORedis, { type Redis } from 'ioredis';

// BullMQ needs maxRetriesPerRequest: null on blocking connections
export function createRedis(url: string): Redis {
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}
