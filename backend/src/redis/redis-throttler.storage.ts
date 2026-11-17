import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from './redis.service';

export interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redisService: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const client = this.redisService.getClient();
    const hitKey = `throttler:${throttlerName}:${key}:hits`;
    const blockKey = `throttler:${throttlerName}:${key}:blocked`;

    const ttlMs = Math.max(1000, ttl);
    const blockDurationMs = blockDuration > 0 ? blockDuration : ttlMs;

    const existingBlockPttl = await client.pttl(blockKey);
    if (existingBlockPttl > 0) {
      const currentHits = Number((await client.get(hitKey)) ?? limit + 1);
      const hitPttl = await client.pttl(hitKey);
      return {
        totalHits: currentHits,
        timeToExpire: Math.ceil(Math.max(0, hitPttl) / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(existingBlockPttl / 1000),
      };
    }

    const totalHits = await client.incr(hitKey);
    let hitPttl = await client.pttl(hitKey);
    if (totalHits === 1 || hitPttl < 0) {
      await client.pexpire(hitKey, ttlMs);
      hitPttl = ttlMs;
    }

    if (totalHits > limit) {
      await client.set(blockKey, '1', 'PX', blockDurationMs);
      return {
        totalHits,
        timeToExpire: Math.ceil(hitPttl / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockDurationMs / 1000),
      };
    }

    return {
      totalHits,
      timeToExpire: Math.ceil(hitPttl / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
