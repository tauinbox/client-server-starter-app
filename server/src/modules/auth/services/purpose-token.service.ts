import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { TokenPurpose } from '@app/shared/constants';
import {
  issuedBeforeMinIat,
  readJwtMinIat
} from '../jwt-module-options.factory';

/**
 * Signs and verifies a token minted for one flow. Every flow signs with the
 * same key, so the purpose claim is what keeps a token of one flow out of
 * another, and the key-rotation floor must end these tokens as it ends access
 * tokens.
 *
 * No session guards these tokens, so a sign-out everywhere ends them only
 * through their issue time. `iat` has whole seconds, which cannot tell a token
 * minted before a revocation from one minted after it in the same second, so
 * each token also carries `iatMs`, the issue time in milliseconds.
 */
@Injectable()
export class PurposeTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService
  ) {}

  sign(
    claims: Record<string, unknown>,
    { purpose, expiresIn }: { purpose: TokenPurpose; expiresIn: number }
  ): string {
    return this.jwtService.sign(
      { ...claims, purpose, iatMs: Date.now() },
      { expiresIn }
    );
  }

  verify<T extends object>(
    token: string,
    purpose: TokenPurpose
  ): (T & { iat: number; issuedAtMs: number }) | null {
    let payload: T & { purpose?: unknown; iat?: unknown; iatMs?: unknown };

    try {
      payload = this.jwtService.verify<
        T & { purpose?: unknown; iat?: unknown; iatMs?: unknown }
      >(token);
    } catch {
      return null;
    }

    const { iat, iatMs } = payload;

    // Fail closed: a token with no millisecond issue time cannot be checked
    // against a revocation in the second it was minted.
    if (
      payload.purpose !== purpose ||
      typeof iat !== 'number' ||
      !Number.isFinite(iat) ||
      typeof iatMs !== 'number' ||
      !Number.isFinite(iatMs) ||
      issuedBeforeMinIat(iat, readJwtMinIat(this.configService))
    ) {
      return null;
    }

    return { ...payload, iat, issuedAtMs: iatMs };
  }
}
