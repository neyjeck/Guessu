import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  private readonly logger = new Logger(GoogleAuthGuard.name);

  constructor(private readonly configService: ConfigService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const result = (await super.canActivate(context)) as boolean;
    const res = context.switchToHttp().getResponse<Response>();
    if (res.headersSent) {
      return false;
    }
    return result;
  }

  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      this.logger.warn(
        `Google OAuth callback failed: ${err instanceof Error ? err.message : String(err ?? 'No user returned')}`,
      );
      const http = context.switchToHttp();
      const res = http.getResponse<Response>();
      const req = http.getRequest<Request>();
      const frontendUrl = this.configService.get<string>(
        'FRONTEND_URL',
        'http://localhost:5173',
      );

      const queryError =
        typeof req.query?.error === 'string' ? req.query.error : null;
      const reason =
        queryError === 'access_denied'
          ? 'google_cancelled'
          : 'google_auth_failed';

      if (!res.headersSent) {
        res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(reason)}`);
      }
      return undefined as unknown as TUser;
    }

    return user;
  }
}
