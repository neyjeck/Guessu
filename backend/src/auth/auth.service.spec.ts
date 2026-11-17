import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Role, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { instanceToPlain } from 'class-transformer';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UserResponseEntity } from '../users/entities/user-response.entity';
import { UsersService } from '../users/users.service';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './auth.constants';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let authService: AuthService;
  let prismaService: {
    user: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let usersService: {
    findByLogin: jest.Mock;
    findById: jest.Mock;
  };
  let redisService: {
    setRefreshTokenSession: jest.Mock;
    rotateRefreshTokenSession: jest.Mock;
    revokeRefreshTokenSession: jest.Mock;
    revokeAllUserSessions: jest.Mock;
  };
  let jwtService: JwtService;

  const createMockResponse = (): Response => {
    const res = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    } as unknown as Response;
    return res;
  };

  const makeMockUser = (overrides: Partial<User> = {}): User => ({
    id: 'user-uuid-1',
    username: 'otaku_detective',
    email: 'otaku@example.com',
    passwordHash: 'hashed-password',
    googleId: null,
    role: Role.USER,
    avatarUrl: null,
    profileTheme: 'default',
    badgeTitle: 'Rookie Guesser',
    rating: 1000,
    currentStreak: 0,
    maxStreak: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });

  beforeEach(async () => {
    prismaService = {
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    usersService = {
      findByLogin: jest.fn(),
      findById: jest.fn(),
    };

    redisService = {
      setRefreshTokenSession: jest.fn().mockResolvedValue(undefined),
      rotateRefreshTokenSession: jest.fn().mockResolvedValue(true),
      revokeRefreshTokenSession: jest.fn().mockResolvedValue(undefined),
      revokeAllUserSessions: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        JwtService,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
        {
          provide: UsersService,
          useValue: usersService,
        },
        {
          provide: RedisService,
          useValue: redisService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => {
              const values: Record<string, string> = {
                NODE_ENV: 'test',
                JWT_ACCESS_SECRET: 'test-access-secret-min-32-chars-long',
                JWT_REFRESH_SECRET: 'test-refresh-secret-min-32-chars-long',
              };
              return values[key] ?? fallback;
            }),
          },
        },
      ],
    }).compile();

    authService = moduleRef.get(AuthService);
    jwtService = moduleRef.get(JwtService);
    await authService.onModuleInit();
  });

  describe('register', () => {
    it('hashes password with argon2id, initializes Redis session, sets HttpOnly cookies, and excludes passwordHash', async () => {
      const res = createMockResponse();
      prismaService.user.findFirst.mockResolvedValue(null);
      prismaService.user.create.mockImplementation(
        async ({ data }: { data: { username: string; email: string; passwordHash: string } }) =>
          makeMockUser({
            username: data.username,
            email: data.email,
            passwordHash: data.passwordHash,
          }),
      );

      const result = await authService.register(
        {
          username: '  otaku_detective  ',
          email: '  OTAKU@Example.com ',
          password: 'Password123',
        },
        res,
      );

      expect(result).toBeInstanceOf(UserResponseEntity);
      expect(result.username).toBe('otaku_detective');
      expect(result.email).toBe('otaku@example.com');

      const createArgs = prismaService.user.create.mock.calls[0][0] as {
        data: { passwordHash: string };
      };
      expect(createArgs.data.passwordHash).toMatch(/^\$argon2id\$/);
      expect(
        await argon2.verify(createArgs.data.passwordHash, 'Password123'),
      ).toBe(true);

      expect(redisService.setRefreshTokenSession).toHaveBeenCalledWith(
        'user-uuid-1',
        expect.any(String),
        RedisService.REFRESH_TOKEN_TTL_SECONDS,
      );

      expect(res.cookie).toHaveBeenCalledTimes(2);
      expect(res.cookie).toHaveBeenCalledWith(
        ACCESS_TOKEN_COOKIE,
        expect.any(String),
        expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
      );
      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE,
        expect.any(String),
        expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
      );

      const serialized = instanceToPlain(result);
      expect(serialized).not.toHaveProperty('passwordHash');
    });

    it('throws ConflictException when username or email already exists', async () => {
      const res = createMockResponse();
      prismaService.user.findFirst.mockResolvedValue(makeMockUser());

      await expect(
        authService.register(
          {
            username: 'otaku_detective',
            email: 'otaku@example.com',
            password: 'Password123',
          },
          res,
        ),
      ).rejects.toThrow(ConflictException);

      expect(prismaService.user.create).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('authenticates valid credentials, creates Redis session, and sets cookies', async () => {
      const res = createMockResponse();
      const passwordHash = await argon2.hash('Password123', {
        type: argon2.argon2id,
      });
      usersService.findByLogin.mockResolvedValue(makeMockUser({ passwordHash }));

      const result = await authService.login(
        { login: 'otaku_detective', password: 'Password123' },
        res,
      );

      expect(result.username).toBe('otaku_detective');
      expect(redisService.setRefreshTokenSession).toHaveBeenCalledTimes(1);
      expect(res.cookie).toHaveBeenCalledTimes(2);
    });

    it('throws UnauthorizedException for unknown user without skipping password verification', async () => {
      const res = createMockResponse();
      const verifySpy = jest.spyOn(argon2, 'verify');
      usersService.findByLogin.mockResolvedValue(null);

      await expect(
        authService.login(
          { login: 'missing_user', password: 'Password123' },
          res,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(res.cookie).not.toHaveBeenCalled();
      verifySpy.mockRestore();
    });

    it('throws UnauthorizedException for wrong password', async () => {
      const res = createMockResponse();
      const passwordHash = await argon2.hash('Password123', {
        type: argon2.argon2id,
      });
      usersService.findByLogin.mockResolvedValue(makeMockUser({ passwordHash }));

      await expect(
        authService.login(
          { login: 'otaku_detective', password: 'WrongPassword1' },
          res,
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(redisService.setRefreshTokenSession).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('rejects password login for Google-only users with a clear message', async () => {
      const res = createMockResponse();
      usersService.findByLogin.mockResolvedValue(
        makeMockUser({ passwordHash: null, googleId: 'google-123' }),
      );

      await expect(
        authService.login(
          { login: 'otaku_detective', password: 'Password123' },
          res,
        ),
      ).rejects.toThrow(
        'This account is linked to Google. Please sign in with Google.',
      );

      expect(redisService.setRefreshTokenSession).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('validateGoogleUser', () => {
    it('returns existing user matched by googleId', async () => {
      const existing = makeMockUser({
        googleId: 'google-123',
        avatarUrl: 'https://example.com/avatar.png',
      });
      prismaService.user.findUnique.mockResolvedValueOnce(existing);

      const user = await authService.validateGoogleUser({
        googleId: 'google-123',
        email: 'otaku@example.com',
        emailVerified: true,
        displayName: 'Otaku',
        avatarUrl: 'https://example.com/new.png',
      });

      expect(user).toBe(existing);
      expect(prismaService.user.create).not.toHaveBeenCalled();
    });

    it('links googleId and avatarUrl to an existing verified-email local account', async () => {
      const localUser = makeMockUser({ googleId: null, avatarUrl: null });
      const linkedUser = makeMockUser({
        googleId: 'google-123',
        avatarUrl: 'https://example.com/google.png',
      });

      prismaService.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(localUser);
      prismaService.user.update.mockResolvedValueOnce(linkedUser);

      const user = await authService.validateGoogleUser({
        googleId: 'google-123',
        email: 'OTAKU@example.com',
        emailVerified: true,
        displayName: 'Otaku',
        avatarUrl: 'https://example.com/google.png',
      });

      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: localUser.id },
        data: {
          googleId: 'google-123',
          avatarUrl: 'https://example.com/google.png',
        },
      });
      expect(user).toBe(linkedUser);
    });

    it('rejects unverified Google email when no googleId match exists', async () => {
      prismaService.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        authService.validateGoogleUser({
          googleId: 'google-123',
          email: 'otaku@example.com',
          emailVerified: false,
          displayName: 'Otaku',
          avatarUrl: null,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('creates a new OAuth user with sanitized unique username', async () => {
      prismaService.user.findUnique
        .mockResolvedValueOnce(null) // by googleId
        .mockResolvedValueOnce(null) // by email
        .mockResolvedValueOnce(null); // username availability check

      prismaService.user.create.mockImplementation(
        async ({
          data,
        }: {
          data: {
            username: string;
            email: string;
            googleId: string;
            passwordHash: null;
            avatarUrl: string | null;
          };
        }) => makeMockUser(data),
      );

      const user = await authService.validateGoogleUser({
        googleId: 'google-999',
        email: 'New.User@Example.com',
        emailVerified: true,
        displayName: 'Anime Fan!',
        avatarUrl: 'https://example.com/pic.png',
      });

      expect(user.username).toBe('Anime_Fan');
      expect(user.email).toBe('new.user@example.com');
      expect(user.googleId).toBe('google-999');
      expect(user.passwordHash).toBeNull();
    });
  });

  describe('refresh', () => {
    it('rotates refresh session in Redis and issues new cookies', async () => {
      const res = createMockResponse();
      const user = makeMockUser();
      usersService.findById.mockResolvedValue(user);

      const refreshToken = await jwtService.signAsync(
        { sub: user.id, sessionId: 'old-session-id', type: 'refresh' },
        { secret: 'test-refresh-secret-min-32-chars-long', expiresIn: '7d' },
      );

      const result = await authService.refresh(refreshToken, res);

      expect(result.id).toBe(user.id);
      expect(redisService.rotateRefreshTokenSession).toHaveBeenCalledWith(
        user.id,
        'old-session-id',
        expect.any(String),
        RedisService.REFRESH_TOKEN_TTL_SECONDS,
      );
      expect(res.cookie).toHaveBeenCalledTimes(2);
    });

    it('revokes all user sessions and clears cookies on refresh token replay', async () => {
      const res = createMockResponse();
      redisService.rotateRefreshTokenSession.mockResolvedValue(false);

      const refreshToken = await jwtService.signAsync(
        { sub: 'user-uuid-1', sessionId: 'replayed-session', type: 'refresh' },
        { secret: 'test-refresh-secret-min-32-chars-long', expiresIn: '7d' },
      );

      await expect(authService.refresh(refreshToken, res)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(redisService.revokeAllUserSessions).toHaveBeenCalledWith(
        'user-uuid-1',
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        ACCESS_TOKEN_COOKIE,
        expect.any(Object),
      );
      expect(res.clearCookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE,
        expect.any(Object),
      );
    });

    it('clears cookies and throws UnauthorizedException when token is missing', async () => {
      const res = createMockResponse();

      await expect(authService.refresh(undefined, res)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(res.clearCookie).toHaveBeenCalledTimes(2);
    });
  });

  describe('logout', () => {
    it('revokes Redis session and clears auth cookies', async () => {
      const res = createMockResponse();
      const refreshToken = await jwtService.signAsync(
        { sub: 'user-uuid-1', sessionId: 'active-session', type: 'refresh' },
        { secret: 'test-refresh-secret-min-32-chars-long', expiresIn: '7d' },
      );

      const result = await authService.logout(refreshToken, res);

      expect(result).toEqual({ message: 'Logged out successfully' });
      expect(redisService.revokeRefreshTokenSession).toHaveBeenCalledWith(
        'user-uuid-1',
        'active-session',
      );
      expect(res.clearCookie).toHaveBeenCalledTimes(2);
    });
  });
});
