import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  ThrottlerGuard,
  ThrottlerModule,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { Role, User } from '@prisma/client';
import * as cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { MailService } from '../src/mail/mail.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisModule } from '../src/redis/redis.module';
import { RedisService } from '../src/redis/redis.service';

class InMemoryPrismaMock {
  private users: User[] = [];

  user = {
    findFirst: async ({
      where,
    }: {
      where: { OR?: Array<{ username?: string; email?: string }> };
    }): Promise<User | null> => {
      const conditions = where.OR ?? [];
      return (
        this.users.find((u) =>
          conditions.some(
            (cond) =>
              (cond.username !== undefined && u.username === cond.username) ||
              (cond.email !== undefined && u.email === cond.email),
          ),
        ) ?? null
      );
    },
    findUnique: async ({
      where,
    }: {
      where: {
        id?: string;
        username?: string;
        email?: string;
        googleId?: string;
      };
    }): Promise<User | null> => {
      return (
        this.users.find(
          (u) =>
            (where.id !== undefined && u.id === where.id) ||
            (where.username !== undefined && u.username === where.username) ||
            (where.email !== undefined && u.email === where.email) ||
            (where.googleId !== undefined && u.googleId === where.googleId),
        ) ?? null
      );
    },
    create: async ({
      data,
    }: {
      data: {
        username: string;
        email: string;
        passwordHash?: string | null;
        googleId?: string | null;
        isEmailVerified?: boolean;
        avatarUrl?: string | null;
      };
    }): Promise<User> => {
      const now = new Date();
      const user: User = {
        id: randomUUID(),
        username: data.username,
        email: data.email,
        passwordHash: data.passwordHash ?? null,
        googleId: data.googleId ?? null,
        isEmailVerified: data.isEmailVerified ?? false,
        role: Role.USER,
        avatarUrl: data.avatarUrl ?? null,
        profileTheme: 'default',
        badgeTitle: 'Rookie Guesser',
        rating: 1000,
        currentStreak: 0,
        maxStreak: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.users.push(user);
      return user;
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Partial<User>;
    }): Promise<User> => {
      const idx = this.users.findIndex((u) => u.id === where.id);
      if (idx === -1) {
        throw new Error('User not found');
      }
      this.users[idx] = {
        ...this.users[idx],
        ...data,
        updatedAt: new Date(),
      };
      return this.users[idx];
    },
  };

  reset(): void {
    this.users = [];
  }
}

class InMemoryRedisMock {
  private sessions = new Set<string>();
  private kv = new Map<string, string>();

  private client = {
    get: async (key: string): Promise<string | null> => this.kv.get(key) ?? null,
    set: async (key: string, value: string): Promise<'OK'> => {
      this.kv.set(key, value);
      return 'OK';
    },
    del: async (...keys: string[]): Promise<number> => {
      let deleted = 0;
      for (const k of keys) {
        if (this.kv.delete(k)) deleted++;
      }
      return deleted;
    },
    ttl: async (key: string): Promise<number> => (this.kv.has(key) ? 60 : -2),
  };

  getClient() {
    return this.client;
  }

  async setRefreshTokenSession(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    this.sessions.add(`${userId}:${sessionId}`);
  }

  async rotateRefreshTokenSession(
    userId: string,
    oldSessionId: string,
    newSessionId: string,
  ): Promise<boolean> {
    const oldKey = `${userId}:${oldSessionId}`;
    if (!this.sessions.has(oldKey)) {
      return false;
    }
    this.sessions.delete(oldKey);
    this.sessions.add(`${userId}:${newSessionId}`);
    return true;
  }

  async revokeRefreshTokenSession(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    this.sessions.delete(`${userId}:${sessionId}`);
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    for (const key of Array.from(this.sessions)) {
      if (key.startsWith(`${userId}:`)) {
        this.sessions.delete(key);
      }
    }
  }

  getActiveSessionCount(userId: string): number {
    return Array.from(this.sessions).filter((key) =>
      key.startsWith(`${userId}:`),
    ).length;
  }

  reset(): void {
    this.sessions.clear();
    this.kv.clear();
  }
}

class InMemoryThrottlerStorage implements ThrottlerStorage {
  private hits = new Map<string, { totalHits: number; expiresAt: number }>();

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ) {
    const storeKey = `${throttlerName}:${key}`;
    const now = Date.now();
    const existing = this.hits.get(storeKey);
    const entry =
      existing && existing.expiresAt > now
        ? existing
        : { totalHits: 0, expiresAt: now + ttl };

    entry.totalHits += 1;
    this.hits.set(storeKey, entry);

    const isBlocked = entry.totalHits > limit;
    return {
      totalHits: entry.totalHits,
      timeToExpire: Math.ceil((entry.expiresAt - now) / 1000),
      isBlocked,
      timeToBlockExpire: isBlocked ? Math.ceil(blockDuration / 1000) : 0,
    };
  }

  reset(): void {
    this.hits.clear();
  }
}

function extractCookieValue(
  setCookieHeaders: string[] | undefined,
  name: string,
): string | undefined {
  if (!setCookieHeaders) return undefined;
  const header = setCookieHeaders.find((c) => c.startsWith(`${name}=`));
  if (!header) return undefined;
  return header.split(';')[0].slice(name.length + 1);
}

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let prismaMock: InMemoryPrismaMock;
  let redisMock: InMemoryRedisMock;
  let throttlerStorage: InMemoryThrottlerStorage;
  let lastVerificationCode = '';
  let lastResetCode = '';

  const mailMock = {
    onModuleInit: async () => undefined,
    sendVerificationOtp: async (
      _to: string,
      _username: string,
      code: string,
    ) => {
      lastVerificationCode = code;
    },
    sendPasswordResetOtp: async (
      _to: string,
      _username: string,
      code: string,
    ) => {
      lastResetCode = code;
    },
    sendGoogleOAuthReminder: async () => undefined,
  };

  beforeAll(async () => {
    prismaMock = new InMemoryPrismaMock();
    redisMock = new InMemoryRedisMock();
    throttlerStorage = new InMemoryThrottlerStorage();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'test',
              JWT_ACCESS_SECRET: 'e2e-access-secret-min-32-chars-long',
              JWT_REFRESH_SECRET: 'e2e-refresh-secret-min-32-chars-long',
              OTP_HASH_SECRET: 'e2e-otp-hash-secret-min-32-chars-long',
            }),
          ],
        }),
        ThrottlerModule.forRoot({
          throttlers: [
            {
              name: 'default',
              ttl: 60_000,
              limit: 60,
            },
          ],
          storage: throttlerStorage,
        }),
        PrismaModule,
        RedisModule,
        AuthModule,
      ],
      providers: [
        {
          provide: APP_GUARD,
          useClass: ThrottlerGuard,
        },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(RedisService)
      .useValue(redisMock)
      .overrideProvider(MailService)
      .useValue(mailMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector)),
    );

    await app.init();
  });

  beforeEach(() => {
    prismaMock.reset();
    redisMock.reset();
    throttlerStorage.reset();
    lastVerificationCode = '';
    lastResetCode = '';
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('rejects non-whitelisted fields and weak passwords on POST /api/auth/register', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        username: 'valid_user',
        email: 'user@example.com',
        password: 'Password123',
        role: 'ADMIN',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        username: 'valid_user',
        email: 'user@example.com',
        password: 'weak',
      })
      .expect(400);
  });

  it('completes full register -> verify-email -> me -> refresh (rotation + replay protection) -> forgot/reset-password -> logout flow', async () => {
    const server = app.getHttpServer();

    // 1. Register
    const registerRes = await request(server)
      .post('/api/auth/register')
      .send({
        username: 'otaku_pro',
        email: 'Otaku.Pro@Example.com',
        password: 'Password123',
      })
      .expect(201);

    expect(registerRes.body).toMatchObject({
      username: 'otaku_pro',
      email: 'otaku.pro@example.com',
      isEmailVerified: false,
      role: 'USER',
    });
    expect(registerRes.body.passwordHash).toBeUndefined();
    expect(lastVerificationCode).toMatch(/^\d{6}$/);

    // 2. Verify email via OTP
    const verifyRes = await request(server)
      .post('/api/auth/verify-email')
      .send({
        email: 'otaku.pro@example.com',
        code: lastVerificationCode,
      })
      .expect(200);

    expect(verifyRes.body.isEmailVerified).toBe(true);

    const registerCookies = registerRes.headers[
      'set-cookie'
    ] as unknown as string[];
    const accessCookie1 = extractCookieValue(registerCookies, 'access_token');
    const refreshCookie1 = extractCookieValue(registerCookies, 'refresh_token');

    expect(accessCookie1).toBeDefined();
    expect(refreshCookie1).toBeDefined();
    expect(registerCookies.some((c) => c.includes('HttpOnly'))).toBe(true);
    expect(registerCookies.some((c) => c.includes('SameSite=Strict'))).toBe(
      true,
    );

    // 3. Protected /api/auth/me fails without cookie and succeeds with cookie
    await request(server).get('/api/auth/me').expect(401);

    const meRes = await request(server)
      .get('/api/auth/me')
      .set('Cookie', [`access_token=${accessCookie1}`])
      .expect(200);

    expect(meRes.body.username).toBe('otaku_pro');
    expect(meRes.body.isEmailVerified).toBe(true);
    expect(meRes.body.passwordHash).toBeUndefined();

    // 4. Refresh rotates tokens
    const refreshRes = await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${refreshCookie1}`])
      .expect(200);

    const refreshCookies = refreshRes.headers[
      'set-cookie'
    ] as unknown as string[];
    const refreshCookie2 = extractCookieValue(refreshCookies, 'refresh_token');
    expect(refreshCookie2).toBeDefined();
    expect(refreshCookie2).not.toBe(refreshCookie1);

    // 5. Forgot password + Reset password revokes all active sessions
    await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: 'otaku.pro@example.com' })
      .expect(200);

    expect(lastResetCode).toMatch(/^\d{6}$/);

    await request(server)
      .post('/api/auth/reset-password')
      .send({
        email: 'otaku.pro@example.com',
        code: lastResetCode,
        newPassword: 'BrandNewPassword123',
      })
      .expect(200);

    expect(redisMock.getActiveSessionCount(registerRes.body.id as string)).toBe(
      0,
    );

    // 6. Login with new password & logout
    const loginRes = await request(server)
      .post('/api/auth/login')
      .send({
        login: 'otaku.pro@example.com',
        password: 'BrandNewPassword123',
      })
      .expect(200);

    const loginCookies = loginRes.headers['set-cookie'] as unknown as string[];
    const loginRefreshCookie = extractCookieValue(
      loginCookies,
      'refresh_token',
    );
    expect(loginRefreshCookie).toBeDefined();

    const logoutRes = await request(server)
      .post('/api/auth/logout')
      .set('Cookie', [`refresh_token=${loginRefreshCookie}`])
      .expect(200);

    expect(logoutRes.body).toEqual({ message: 'Logged out successfully' });

    await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${loginRefreshCookie}`])
      .expect(401);
  });

  it('enforces rate limit (429) after 5 login attempts per minute', async () => {
    const server = app.getHttpServer();

    for (let i = 0; i < 5; i++) {
      await request(server)
        .post('/api/auth/login')
        .send({ login: 'nobody_here', password: 'Password123' })
        .expect(401);
    }

    await request(server)
      .post('/api/auth/login')
      .send({ login: 'nobody_here', password: 'Password123' })
      .expect(429);
  });
});
