import {
  ConflictException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomInt, randomUUID } from 'crypto';
import { CookieOptions, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UserResponseEntity } from '../users/entities/user-response.entity';
import { UsersService } from '../users/users.service';
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE_MS,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_MAX_AGE_MS,
} from './auth.constants';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AccessTokenPayload } from './strategies/jwt.strategy';

export interface RefreshTokenPayload {
  sub: string;
  sessionId: string;
  type: 'refresh';
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

export interface GoogleUserProfile {
  googleId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyPasswordHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyPasswordHash = await argon2.hash(
      'constant-time-dummy-password-placeholder',
      {
        type: argon2.argon2id,
      },
    );
  }

  async register(
    dto: RegisterDto,
    res: Response,
  ): Promise<UserResponseEntity> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const trimmedUsername = dto.username.trim();

    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: trimmedUsername }, { email: normalizedEmail }],
      },
    });

    if (existing) {
      throw new ConflictException('Username or email is already registered');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    const user = await this.prisma.user.create({
      data: {
        username: trimmedUsername,
        email: normalizedEmail,
        passwordHash,
      },
    });

    await this.createSessionAndAttachCookies(user, res);
    return new UserResponseEntity(user);
  }

  async login(dto: LoginDto, res: Response): Promise<UserResponseEntity> {
    const user = await this.usersService.findByLogin(dto.login);

    const hashToCompare =
      user?.passwordHash ||
      this.dummyPasswordHash ||
      (await argon2.hash('fallback-dummy-password'));

    const isPasswordValid = await argon2.verify(hashToCompare, dto.password);

    if (user && !user.passwordHash) {
      throw new UnauthorizedException(
        'This account is linked to Google. Please sign in with Google.',
      );
    }

    if (!user || !isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.createSessionAndAttachCookies(user, res);
    return new UserResponseEntity(user);
  }

  async validateGoogleUser(profile: GoogleUserProfile): Promise<User> {
    const existingByGoogleId = await this.prisma.user.findUnique({
      where: { googleId: profile.googleId },
    });

    if (existingByGoogleId) {
      if (!existingByGoogleId.avatarUrl && profile.avatarUrl) {
        return this.prisma.user.update({
          where: { id: existingByGoogleId.id },
          data: { avatarUrl: profile.avatarUrl },
        });
      }
      return existingByGoogleId;
    }

    if (!profile.email || !profile.emailVerified) {
      throw new UnauthorizedException(
        'Google account must have a verified email address',
      );
    }

    const normalizedEmail = profile.email.trim().toLowerCase();
    const existingByEmail = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingByEmail) {
      return this.prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          googleId: profile.googleId,
          avatarUrl: existingByEmail.avatarUrl ?? profile.avatarUrl,
        },
      });
    }

    const username = await this.generateUniqueUsername(
      profile.displayName || normalizedEmail.split('@')[0] || 'guesser',
    );

    return this.prisma.user.create({
      data: {
        username,
        email: normalizedEmail,
        googleId: profile.googleId,
        passwordHash: null,
        avatarUrl: profile.avatarUrl,
      },
    });
  }

  async loginWithOAuthUser(user: User, res: Response): Promise<void> {
    await this.createSessionAndAttachCookies(user, res);
  }

  async refresh(
    refreshToken: string | undefined,
    res: Response,
  ): Promise<UserResponseEntity> {
    if (!refreshToken) {
      this.clearAuthCookies(res);
      throw new UnauthorizedException('Refresh token is missing');
    }

    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        {
          secret: this.getRefreshSecret(),
        },
      );
    } catch {
      this.clearAuthCookies(res);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (
      !payload?.sub ||
      !payload?.sessionId ||
      payload.type !== 'refresh'
    ) {
      this.clearAuthCookies(res);
      throw new UnauthorizedException('Malformed refresh token payload');
    }

    const newSessionId = randomUUID();
    const rotated = await this.redisService.rotateRefreshTokenSession(
      payload.sub,
      payload.sessionId,
      newSessionId,
      RedisService.REFRESH_TOKEN_TTL_SECONDS,
    );

    if (!rotated) {
      // Potential token reuse / replay: revoke all active sessions for this user
      await this.redisService.revokeAllUserSessions(payload.sub);
      this.clearAuthCookies(res);
      throw new UnauthorizedException(
        'Refresh session has expired or been revoked',
      );
    }

    let user: User;
    try {
      user = await this.usersService.findById(payload.sub);
    } catch {
      await this.redisService.revokeRefreshTokenSession(
        payload.sub,
        newSessionId,
      );
      this.clearAuthCookies(res);
      throw new UnauthorizedException('User account not found');
    }

    const tokens = await this.issueTokenPair(user, newSessionId);
    this.attachAuthCookies(res, tokens);

    return new UserResponseEntity(user);
  }

  async logout(
    refreshToken: string | undefined,
    res: Response,
  ): Promise<{ message: string }> {
    if (refreshToken) {
      try {
        const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
          refreshToken,
          {
            secret: this.getRefreshSecret(),
          },
        );
        if (payload?.sub && payload?.sessionId) {
          await this.redisService.revokeRefreshTokenSession(
            payload.sub,
            payload.sessionId,
          );
        }
      } catch {
        // Ignore verification errors on logout; cookies are still cleared below
      }
    }

    this.clearAuthCookies(res);
    return { message: 'Logged out successfully' };
  }

  private async generateUniqueUsername(rawName: string): Promise<string> {
    let base = rawName
      .trim()
      .replace(/[^a-zA-Z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (base.length < 3) {
      base = `guesser_${base}`.replace(/_+$/, '');
    }
    base = base.slice(0, 15);

    const existingBase = await this.prisma.user.findUnique({
      where: { username: base },
    });
    if (!existingBase) {
      return base;
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      const suffix = String(randomInt(1000, 9999));
      const candidate = `${base.slice(0, 20 - suffix.length)}${suffix}`;
      const taken = await this.prisma.user.findUnique({
        where: { username: candidate },
      });
      if (!taken) {
        return candidate;
      }
    }

    return `user_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }

  private async createSessionAndAttachCookies(
    user: User,
    res: Response,
  ): Promise<void> {
    const sessionId = randomUUID();
    await this.redisService.setRefreshTokenSession(
      user.id,
      sessionId,
      RedisService.REFRESH_TOKEN_TTL_SECONDS,
    );

    const tokens = await this.issueTokenPair(user, sessionId);
    this.attachAuthCookies(res, tokens);
  }

  private async issueTokenPair(
    user: User,
    sessionId: string,
  ): Promise<IssuedTokens> {
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      type: 'access',
    };

    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      sessionId,
      type: 'refresh',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.getAccessSecret(),
        expiresIn: '15m',
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.getRefreshSecret(),
        expiresIn: '7d',
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private getBaseCookieOptions(): CookieOptions {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    return {
      httpOnly: true,
      sameSite: 'strict',
      secure: isProduction,
      path: '/',
    };
  }

  attachAuthCookies(res: Response, tokens: IssuedTokens): void {
    const baseOptions = this.getBaseCookieOptions();

    res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
      ...baseOptions,
      maxAge: ACCESS_TOKEN_MAX_AGE_MS,
    });

    res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      ...baseOptions,
      maxAge: REFRESH_TOKEN_MAX_AGE_MS,
    });
  }

  clearAuthCookies(res: Response): void {
    const baseOptions = this.getBaseCookieOptions();
    res.clearCookie(ACCESS_TOKEN_COOKIE, baseOptions);
    res.clearCookie(REFRESH_TOKEN_COOKIE, baseOptions);
  }

  private getAccessSecret(): string {
    return this.configService.get<string>(
      'JWT_ACCESS_SECRET',
      'dev-local-access-secret-9f8e7d6c5b4a3210-anime-guesser',
    );
  }

  private getRefreshSecret(): string {
    return this.configService.get<string>(
      'JWT_REFRESH_SECRET',
      'dev-local-refresh-secret-1a2b3c4d5e6f7890-anime-guesser',
    );
  }
}
