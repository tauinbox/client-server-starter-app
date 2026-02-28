import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { CustomJwtPayload, PayloadFromJwt } from '../types/jwt-payload';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private dataSource: DataSource
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow('JWT_SECRET'),
      algorithms: ['HS256']
    });
  }

  async validate(payload: CustomJwtPayload): Promise<PayloadFromJwt> {
    const userId = payload.sub!;
    const user = await this.dataSource
      .getRepository(User)
      .findOne({ where: { id: userId }, select: ['id', 'tokenRevokedAt'] });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (
      user.tokenRevokedAt &&
      payload.iat! < user.tokenRevokedAt.getTime() / 1000
    ) {
      throw new UnauthorizedException('Token has been revoked');
    }

    return {
      userId,
      email: payload.email,
      roles: payload.roles ?? []
    };
  }
}
