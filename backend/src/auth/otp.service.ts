import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { RedisService } from '../redis/redis.service';

export type OtpPurpose = 'verify' | 'reset';

interface StoredOtpRecord {
  hash: string;
  attempts: number;
}

@Injectable()
export class OtpService {
  public static readonly OTP_TTL_SECONDS = 600; // 10 minutes
  public static readonly COOLDOWN_TTL_SECONDS = 60; // 60 seconds
  public static readonly MAX_ATTEMPTS = 3;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  private buildOtpKey(purpose: OtpPurpose, email: string): string {
    return `otp:${purpose}:${email.trim().toLowerCase()}`;
  }

  private buildCooldownKey(purpose: OtpPurpose, email: string): string {
    return `otp_cooldown:${purpose}:${email.trim().toLowerCase()}`;
  }

  private hashCode(purpose: OtpPurpose, email: string, code: string): string {
    const secret = this.configService.get<string>(
      'OTP_HASH_SECRET',
      this.configService.get<string>(
        'JWT_ACCESS_SECRET',
        'dev-local-otp-hash-secret-7a8b9c0d1e2f3a4b-anime-guesser',
      ),
    );
    const normalizedEmail = email.trim().toLowerCase();
    return createHash('sha256')
      .update(`${purpose}:${normalizedEmail}:${code}:${secret}`)
      .digest('hex');
  }

  generateSixDigitCode(): string {
    return String(randomInt(100000, 999999));
  }

  async issueAndSendOtp(
    purpose: OtpPurpose,
    email: string,
    sendMailFn: (code: string) => Promise<void>,
  ): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const client = this.redisService.getClient();
    const otpKey = this.buildOtpKey(purpose, normalizedEmail);
    const cooldownKey = this.buildCooldownKey(purpose, normalizedEmail);

    const cooldownTtl = await client.ttl(cooldownKey);
    if (cooldownTtl > 0) {
      throw new HttpException(
        `Please wait ${cooldownTtl} seconds before requesting another verification code.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = this.generateSixDigitCode();
    const record: StoredOtpRecord = {
      hash: this.hashCode(purpose, normalizedEmail, code),
      attempts: 0,
    };

    await client.set(
      otpKey,
      JSON.stringify(record),
      'EX',
      OtpService.OTP_TTL_SECONDS,
    );
    await client.set(
      cooldownKey,
      '1',
      'EX',
      OtpService.COOLDOWN_TTL_SECONDS,
    );

    try {
      await sendMailFn(code);
    } catch {
      await client.del(otpKey, cooldownKey);
      throw new ServiceUnavailableException(
        'Unable to send verification email via SMTP. Please try again later.',
      );
    }
  }

  async verifyOtp(
    purpose: OtpPurpose,
    email: string,
    code: string,
  ): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const client = this.redisService.getClient();
    const otpKey = this.buildOtpKey(purpose, normalizedEmail);
    const cooldownKey = this.buildCooldownKey(purpose, normalizedEmail);

    const raw = await client.get(otpKey);
    if (!raw) {
      throw new BadRequestException(
        'Verification code has expired or does not exist. Please request a new code.',
      );
    }

    let record: StoredOtpRecord;
    try {
      record = JSON.parse(raw) as StoredOtpRecord;
    } catch {
      await client.del(otpKey);
      throw new BadRequestException(
        'Invalid verification state. Please request a new code.',
      );
    }

    const expectedHash = Buffer.from(record.hash, 'hex');
    const candidateHash = Buffer.from(
      this.hashCode(purpose, normalizedEmail, code.trim()),
      'hex',
    );

    const isMatch =
      expectedHash.length === candidateHash.length &&
      timingSafeEqual(expectedHash, candidateHash);

    if (!isMatch) {
      const nextAttempts = record.attempts + 1;
      if (nextAttempts >= OtpService.MAX_ATTEMPTS) {
        await client.del(otpKey);
        throw new BadRequestException(
          'Too many failed attempts. Your code has been invalidated; please request a new code.',
        );
      }

      const remainingTtl = await client.ttl(otpKey);
      const ttlToKeep =
        remainingTtl > 0 ? remainingTtl : OtpService.OTP_TTL_SECONDS;
      await client.set(
        otpKey,
        JSON.stringify({ ...record, attempts: nextAttempts }),
        'EX',
        ttlToKeep,
      );

      const remainingAttempts = OtpService.MAX_ATTEMPTS - nextAttempts;
      throw new BadRequestException(
        `Invalid verification code. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining.`,
      );
    }

    await client.del(otpKey, cooldownKey);
  }
}
