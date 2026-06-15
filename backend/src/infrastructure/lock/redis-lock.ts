import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { DistributedLock, LockHandle } from '../../domain/ports/services';

// delete only if we still own it (don't drop a lock someone else re-took)
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

// single-node SET NX PX lock; multi-node would use Redlock
export class RedisLock implements DistributedLock {
  constructor(private readonly redis: Redis) {}

  async acquire(key: string, ttlMs: number): Promise<LockHandle | null> {
    const token = randomUUID();
    const lockKey = `lock:${key}`;
    const ok = await this.redis.set(lockKey, token, 'PX', ttlMs, 'NX');
    if (ok !== 'OK') return null;
    return {
      release: async () => {
        await this.redis.eval(RELEASE_SCRIPT, 1, lockKey, token);
      },
    };
  }
}
