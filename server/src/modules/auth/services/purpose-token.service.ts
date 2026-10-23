import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { TokenPurpose } from '@app/shared/constants';
import {
  issuedBeforeMinIat,
  readJwtMinIat
} from '../jwt-module-options.factory';

/**
 * Verifies a token minted for one flow. Every flow signs with the same key, so
 * the purpose claim is what keeps a token of one flow out of another, and the
 * key-rotation floor must end these tokens as it ends access tokens.
 */
@Injectable()
export class PurposeTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService
  ) {}

  verify<T extends object>(
    token: string,
    purpose: TokenPurpose
  ): (T & { iat: number }) | null {
    let payload: T & { purpose?: unknown; iat?: unknown };
    try {
      payload = this.jwtService.verify<
        T & { purpose?: unknown; iat?: unknown }
      >(token);
    } catch {
      return null;
    }

    const { iat } = payload;
    if (
      payload.purpose !== purpose ||
      typeof iat !== 'number' ||
      !Number.isFinite(iat) ||
      issuedBeforeMinIat(iat, readJwtMinIat(this.configService))
    ) {
      return null;
    }

    return { ...payload, iat };
  }
}
