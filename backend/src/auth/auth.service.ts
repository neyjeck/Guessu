import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomInt, randomUUID } from 'crypto';
import { CookieOptions, Response } from 'express';
import { MailService } from '../mail/mail.service';
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
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { OtpService } from './otp.service';
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
  private readonly logger = new Logger(AuthService.name);
  private dummyPasswordHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly otpService: OtpService,
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
        isEmailVerified: false,
      },
    });

    await this.createSessionAndAttachCookies(user, res);

    try {
      await this.otpService.issueAndSendOtp('verify', user.email, (code) =>
        this.mailService.sendVerificationOtp(user.email, user.username, code),
      );
    } catch (error) {
      this.logger.warn(
        `Automatic verification email dispatch failed for ${user.email}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return new UserResponseEntity(user);
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<UserResponseEntity> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(normalizedEmail);
    if (!user) {
      throw new BadRequestException('Invalid email or verification code');
    }

    if (user.isEmailVerified) {
      return new UserResponseEntity(user);
    }

    await this.otpService.verifyOtp('verify', normalizedEmail, dto.code);

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true },
    });

    return new UserResponseEntity(updatedUser);
  }

  async resendVerification(
    dto: ResendVerificationDto,
  ): Promise<{ message: string }> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(normalizedEmail);
    if (!user) {
      throw new BadRequestException('Account not found for this email address');
    }

    if (user.isEmailVerified) {
      throw new BadRequestException('Email address is already verified');
    }

    await this.otpService.issueAndSendOtp('verify', user.email, (code) =>
      this.mailService.sendVerificationOtp(user.email, user.username, code),
    );

    return { message: 'Verification code has been sent to your email.' };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const genericMessage =
      'If an account with that email exists, a verification code has been sent.';
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(normalizedEmail);

    if (!user) {
      return { message: genericMessage };
    }

    if (user.passwordHash === null) {
      try {
        await this.mailService.sendGoogleOAuthReminder(
          user.email,
          user.username,
        );
      } catch {
        throw new ServiceUnavailableException(
          'Unable to send email via SMTP. Please try again later.',
        );
      }
      return { message: genericMessage };
    }

    await this.otpService.issueAndSendOtp('reset', user.email, (code) =>
      this.mailService.sendPasswordResetOtp(user.email, user.username, code),
    );

    return { message: genericMessage };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(normalizedEmail);
    if (!user) {
      throw new BadRequestException('Invalid email or verification code');
    }

    await this.otpService.verifyOtp('reset', normalizedEmail, dto.code);

    const passwordHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        isEmailVerified: true,
      },
    });

    await this.redisService.revokeAllUserSessions(user.id);

    return {
      message:
        'Password has been reset successfully. Please sign in with your new password.',
    };
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
      if (
        (!existingByGoogleId.avatarUrl && profile.avatarUrl) ||
        !existingByGoogleId.isEmailVerified
      ) {
        return this.prisma.user.update({
          where: { id: existingByGoogleId.id },
          data: {
            avatarUrl: existingByGoogleId.avatarUrl ?? profile.avatarUrl,
            isEmailVerified: true,
          },
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
          isEmailVerified: true,
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
        isEmailVerified: true,
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
