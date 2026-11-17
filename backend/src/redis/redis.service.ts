import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  public static readonly REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>(
      'REDIS_URL',
      'redis://localhost:6379',
    );
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });

    this.client.on('error', (err: Error) => {
      this.logger.error(`Redis connection error: ${err.message}`);
    });
  }

  getClient(): Redis {
    return this.client;
  }

  private buildRefreshKey(userId: string, sessionId: string): string {
    return `refresh_token:${userId}:${sessionId}`;
  }

  async setRefreshTokenSession(
    userId: string,
    sessionId: string,
    ttlSeconds: number = RedisService.REFRESH_TOKEN_TTL_SECONDS,
  ): Promise<void> {
    const key = this.buildRefreshKey(userId, sessionId);
    await this.client.set(
      key,
      JSON.stringify({ createdAt: new Date().toISOString() }),
      'EX',
      ttlSeconds,
    );
  }

  async validateRefreshTokenSession(
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
    const key = this.buildRefreshKey(userId, sessionId);
    const exists = await this.client.exists(key);
    return exists === 1;
  }

  async rotateRefreshTokenSession(
    userId: string,
    oldSessionId: string,
    newSessionId: string,
    ttlSeconds: number = RedisService.REFRESH_TOKEN_TTL_SECONDS,
  ): Promise<boolean> {
    const oldKey = this.buildRefreshKey(userId, oldSessionId);
    const newKey = this.buildRefreshKey(userId, newSessionId);

    const deletedCount = await this.client.del(oldKey);
    if (deletedCount === 0) {
      return false;
    }

    await this.client.set(
      newKey,
      JSON.stringify({
        createdAt: new Date().toISOString(),
        rotatedFrom: oldSessionId,
      }),
      'EX',
      ttlSeconds,
    );
    return true;
  }

  async revokeRefreshTokenSession(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const key = this.buildRefreshKey(userId, sessionId);
    await this.client.del(key);
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    const pattern = `refresh_token:${userId}:*`;
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } while (cursor !== '0');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
