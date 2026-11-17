import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Role, User } from '@prisma/client';
import { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';
import { ACCESS_TOKEN_COOKIE } from '../auth.constants';

export interface AccessTokenPayload {
  sub: string;
  username: string;
  role: Role;
  type: 'access';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request): string | null => {
          const cookies = req?.cookies as Record<string, unknown> | undefined;
          const token = cookies?.[ACCESS_TOKEN_COOKIE];
          return typeof token === 'string' && token.length > 0 ? token : null;
        },
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(
        'JWT_ACCESS_SECRET',
        'dev-local-access-secret-9f8e7d6c5b4a3210-anime-guesser',
      ),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<User> {
    if (!payload?.sub || payload.type !== 'access') {
      throw new UnauthorizedException('Invalid access token payload');
    }

    try {
      return await this.usersService.findById(payload.sub);
    } catch {
      throw new UnauthorizedException('User account no longer exists');
    }
  }
}
