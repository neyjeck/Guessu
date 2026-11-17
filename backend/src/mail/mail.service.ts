import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly fromAddress: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST', '').trim();
    const port = Number(this.configService.get<string>('SMTP_PORT', '587'));
    const secureRaw = this.configService
      .get<string>('SMTP_SECURE', 'false')
      .trim()
      .toLowerCase();
    const secure = secureRaw === 'true' || secureRaw === '1' || port === 465;
    const user = this.configService.get<string>('SMTP_USER', '').trim();
    const pass = this.configService.get<string>('SMTP_PASS', '').trim();
    this.fromAddress = this.configService
      .get<string>('SMTP_FROM', 'Anime Guesser <no-reply@animeguesser.local>')
      .trim();

    if (!host || !port || !user || !pass) {
      this.logger.warn(
        'SMTP configuration (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) is incomplete.',
      );
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.transporter.verify();
      this.logger.log(
        'SMTP transporter verified and ready for email delivery.',
      );
    } catch (error) {
      this.logger.warn(
        `SMTP connection verification failed on startup: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async sendVerificationOtp(
    toEmail: string,
    username: string,
    code: string,
  ): Promise<void> {
    const subject = `${code} is your Anime Guesser verification code`;
    const text = [
      `Hello ${username},`,
      '',
      'Welcome to Anime Guesser! Use the 6-digit verification code below to verify your email address:',
      '',
      `Verification Code: ${code}`,
      '',
      'This code will expire in 10 minutes.',
      'If you did not create an Anime Guesser account, you can safely ignore this email.',
    ].join('\n');

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px; background-color: #0b0f19; color: #f3f4f6; border: 1px solid #1f2937; border-radius: 12px;">
        <h2 style="margin: 0 0 16px; color: #c084fc; font-size: 20px;">Verify your Anime Guesser account</h2>
        <p style="margin: 0 0 16px; color: #d1d5db; line-height: 1.5; font-size: 15px;">
          Hello <strong>${this.escapeHtml(username)}</strong>,
        </p>
        <p style="margin: 0 0 20px; color: #d1d5db; line-height: 1.5; font-size: 15px;">
          Enter the following 6-digit verification code to confirm your email address. This code expires in <strong>10 minutes</strong>:
        </p>
        <div style="text-align: center; margin: 24px 0; padding: 18px; background-color: #111827; border: 1px solid #374151; border-radius: 8px;">
          <span style="font-size: 30px; font-weight: 700; letter-spacing: 8px; color: #f9fafb; font-family: monospace;">${this.escapeHtml(code)}</span>
        </div>
        <p style="margin: 20px 0 0; color: #9ca3af; font-size: 13px; line-height: 1.5;">
          If you did not sign up for Anime Guesser, please ignore this message.
        </p>
      </div>
    `;

    await this.transporter.sendMail({
      from: this.fromAddress,
      to: toEmail,
      subject,
      text,
      html,
    });
  }

  async sendPasswordResetOtp(
    toEmail: string,
    username: string,
    code: string,
  ): Promise<void> {
    const subject = `${code} is your Anime Guesser password reset code`;
    const text = [
      `Hello ${username},`,
      '',
      'We received a request to reset the password for your Anime Guesser account.',
      'Use the 6-digit code below to complete your password reset:',
      '',
      `Password Reset Code: ${code}`,
      '',
      'This code expires in 10 minutes.',
      'SECURITY WARNING: Never share this code with anyone. If you did not request a password reset, your account is still secure and you can ignore this email.',
    ].join('\n');

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px; background-color: #0b0f19; color: #f3f4f6; border: 1px solid #1f2937; border-radius: 12px;">
        <h2 style="margin: 0 0 16px; color: #c084fc; font-size: 20px;">Password Reset Request</h2>
        <p style="margin: 0 0 16px; color: #d1d5db; line-height: 1.5; font-size: 15px;">
          Hello <strong>${this.escapeHtml(username)}</strong>,
        </p>
        <p style="margin: 0 0 20px; color: #d1d5db; line-height: 1.5; font-size: 15px;">
          Use the following 6-digit code to reset your Anime Guesser password. This code is valid for <strong>10 minutes</strong>:
        </p>
        <div style="text-align: center; margin: 24px 0; padding: 18px; background-color: #111827; border: 1px solid #374151; border-radius: 8px;">
          <span style="font-size: 30px; font-weight: 700; letter-spacing: 8px; color: #f9fafb; font-family: monospace;">${this.escapeHtml(code)}</span>
        </div>
        <div style="margin: 20px 0 0; padding: 12px 14px; background-color: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 8px; color: #fca5a5; font-size: 13px; line-height: 1.5;">
          <strong>Security Warning:</strong> Never share this code with anyone. Completing a password reset will automatically sign you out of all active devices. If you did not request this reset, you can safely disregard this email.
        </div>
      </div>
    `;

    await this.transporter.sendMail({
      from: this.fromAddress,
      to: toEmail,
      subject,
      text,
      html,
    });
  }

  async sendGoogleOAuthReminder(
    toEmail: string,
    username: string,
  ): Promise<void> {
    const subject = 'Anime Guesser Sign-In Reminder (Google Account)';
    const text = [
      `Hello ${username},`,
      '',
      'We received a password reset request for your Anime Guesser account.',
      'Your account is currently linked with Google Sign-In and does not use a separate password.',
      'Please sign in using the "Continue with Google" button on Anime Guesser.',
    ].join('\n');

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px; background-color: #0b0f19; color: #f3f4f6; border: 1px solid #1f2937; border-radius: 12px;">
        <h2 style="margin: 0 0 16px; color: #c084fc; font-size: 20px;">Sign In with Google</h2>
        <p style="margin: 0 0 16px; color: #d1d5db; line-height: 1.5; font-size: 15px;">
          Hello <strong>${this.escapeHtml(username)}</strong>,
        </p>
        <p style="margin: 0 0 16px; color: #d1d5db; line-height: 1.5; font-size: 15px;">
          We received a password reset request for this email address. Your Anime Guesser account was registered via <strong>Google Sign-In</strong> and does not have a local password.
        </p>
        <p style="margin: 0; color: #9ca3af; font-size: 14px; line-height: 1.5;">
          To access your account, simply click <strong>"Continue with Google"</strong> on the Sign In screen.
        </p>
      </div>
    `;

    await this.transporter.sendMail({
      from: this.fromAddress,
      to: toEmail,
      subject,
      text,
      html,
    });
  }

  private escapeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
