import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { User } from '@prisma/client';
import { Profile, Strategy } from 'passport-google-oauth20';
import { AuthService, GoogleUserProfile } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID', '');
    const clientSecret = configService.get<string>('GOOGLE_CLIENT_SECRET', '');
    const callbackURL = configService.get<string>(
      'GOOGLE_CALLBACK_URL',
      'http://localhost:3000/api/auth/google/callback',
    );

    if (!clientID || !clientSecret || clientID.startsWith('unconfigured-')) {
      Logger.warn(
        'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not configured; Google OAuth login will fail until real credentials are provided.',
        GoogleStrategy.name,
      );
    }

    super({
      clientID: clientID || 'unconfigured-google-client-id',
      clientSecret: clientSecret || 'unconfigured-google-client-secret',
      callbackURL,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): Promise<User> {
    try {
      const primaryEmail = profile.emails?.[0];
      const rawJson = profile._json as
        | { email_verified?: boolean | string }
        | undefined;
      const emailVerifiedRaw =
        primaryEmail?.verified ?? rawJson?.email_verified;
      const emailVerified =
        emailVerifiedRaw === true || emailVerifiedRaw === 'true';

      const googleProfile: GoogleUserProfile = {
        googleId: profile.id,
        email: primaryEmail?.value ?? null,
        emailVerified,
        displayName:
          profile.displayName ||
          profile.name?.givenName ||
          primaryEmail?.value?.split('@')[0] ||
          'guesser',
        avatarUrl: profile.photos?.[0]?.value ?? null,
      };

      return await this.authService.validateGoogleUser(googleProfile);
    } catch (error) {
      this.logger.warn(
        `Google OAuth validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Google authentication failed');
    }
  }
}
