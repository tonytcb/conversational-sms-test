import type { Redis } from 'ioredis';
import type { SequenceAllocator } from '../../domain/ports/services';

// Per-conversation receive-order counter. A single atomic INCR keeps the webhook hot
// path DB-free (the 5s Twilio budget is never at risk) while giving a strictly
// monotonic `seq` per conversation — the stable ordering key for the worker's head
// check and the reorder buffer. Gaps (from deduped duplicate deliveries) are fine:
// only relative order matters, not contiguity.
export class RedisSequenceAllocator implements SequenceAllocator {
  constructor(private readonly redis: Redis) {}

  async next(key: string): Promise<number> {
    return this.redis.incr(`seq:${key}`);
  }
}
