import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { CustomJwtPayload, PayloadFromJwt } from '../types/jwt-payload';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly minIat: number | undefined;

  constructor(
    private configService: ConfigService,
    private dataSource: DataSource
  ) {
    const algorithm = configService.get<string>('JWT_ALGORITHM') ?? 'HS256';
    const secretOrKey =
      algorithm === 'RS256'
        ? Buffer.from(
            configService.getOrThrow<string>('JWT_PUBLIC_KEY'),
            'base64'
          ).toString('utf-8')
        : configService.getOrThrow<string>('JWT_SECRET');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey,
      algorithms: [algorithm as 'HS256' | 'RS256']
    });

    const rawMinIat = this.configService.get<number>('JWT_MIN_IAT');
    this.minIat = rawMinIat !== undefined ? Number(rawMinIat) : undefined;
  }

  async validate(payload: CustomJwtPayload): Promise<PayloadFromJwt> {
    // SRV-12: global key rotation — reject tokens issued before the rotation timestamp
    if (this.minIat !== undefined && payload.iat! < this.minIat) {
      throw new UnauthorizedException(
        'Token invalidated due to key rotation. Please log in again.'
      );
    }

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
