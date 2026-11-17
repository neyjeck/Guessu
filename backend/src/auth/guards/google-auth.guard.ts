import { ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
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

      res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(reason)}`);
      return undefined as unknown as TUser;
    }

    return user;
  }
}
