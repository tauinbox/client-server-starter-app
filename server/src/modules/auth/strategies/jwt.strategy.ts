import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { CustomJwtPayload, PayloadFromJwt } from '../types/jwt-payload';
import { User } from '../../users/entities/user.entity';
import { ErrorKeys } from '@app/shared/constants/error-keys';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  TOKEN_PURPOSE
} from '@app/shared/constants/auth.constants';

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
      algorithms: [algorithm as 'HS256' | 'RS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });

    const rawMinIat = this.configService.get<number>('JWT_MIN_IAT');
    this.minIat = rawMinIat !== undefined ? Number(rawMinIat) : undefined;
  }

  async validate(payload: CustomJwtPayload): Promise<PayloadFromJwt> {
    // Every token this service issues is signed with the same key, so a token
    // minted for another flow (OAuth link/data) would otherwise be accepted
    // here. Requiring the access purpose keeps those flows non-interchangeable.
    if (payload.purpose !== TOKEN_PURPOSE.ACCESS) {
      throw new HttpException(
        {
          message: 'Token is not an access token',
          errorKey: ErrorKeys.AUTH.INVALID_TOKEN
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    // Fail closed: a missing subject would leave the lookup below unconstrained,
    // which resolves to an arbitrary user instead of failing
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new HttpException(
        {
          message: 'Token is missing a valid subject claim',
          errorKey: ErrorKeys.AUTH.INVALID_TOKEN
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    const iat = payload.iat;
    // Fail closed: without a trusted issue time the key-rotation and
    // token-revocation checks below cannot be enforced
    if (typeof iat !== 'number' || !Number.isFinite(iat)) {
      throw new HttpException(
        {
          message: 'Token is missing a valid issued-at claim',
          errorKey: ErrorKeys.AUTH.INVALID_TOKEN
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    // SRV-12: global key rotation — reject tokens issued before the rotation timestamp
    if (this.minIat !== undefined && iat < this.minIat) {
      throw new HttpException(
        {
          message:
            'Token invalidated due to key rotation. Please log in again.',
          errorKey: ErrorKeys.AUTH.TOKEN_INVALIDATED_ROTATION
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    const userId = payload.sub;
    const user = await this.dataSource
      .getRepository(User)
      .findOne({ where: { id: userId }, select: ['id', 'tokenRevokedAt'] });

    if (!user) {
      throw new HttpException(
        {
          message: 'User not found',
          errorKey: ErrorKeys.AUTH.USER_NOT_FOUND
        },
        HttpStatus.UNAUTHORIZED
      );
    }
    if (user.tokenRevokedAt && iat < user.tokenRevokedAt.getTime() / 1000) {
      throw new HttpException(
        {
          message: 'Token has been revoked',
          errorKey: ErrorKeys.AUTH.TOKEN_REVOKED
        },
        HttpStatus.UNAUTHORIZED
      );
    }

    return {
      userId,
      email: payload.email,
      roles: payload.roles ?? []
    };
  }
}
