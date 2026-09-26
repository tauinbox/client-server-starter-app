import type { JwtModuleOptions } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import { JWT_AUDIENCE, JWT_ISSUER } from '@app/shared/constants';

/** What a verifier needs to accept a token this service signed. */
export interface JwtVerification {
  algorithm: 'HS256' | 'RS256';
  /** The HMAC secret, or the PEM public key under RS256. */
  key: string;
  issuer: string;
  audience: string;
}

/**
 * Single source of the verification options. `JwtModule` and the passport
 * strategy both read it, so the two verifiers cannot disagree on the key, the
 * algorithm or the claims a token must carry.
 */
export function buildJwtVerification(
  configService: ConfigService
): JwtVerification {
  const issuerAudience = { issuer: JWT_ISSUER, audience: JWT_AUDIENCE };
  if (configService.get<string>('JWT_ALGORITHM') === 'RS256') {
    return {
      algorithm: 'RS256',
      key: decodeKey(configService, 'JWT_PUBLIC_KEY'),
      ...issuerAudience
    };
  }
  return {
    algorithm: 'HS256',
    key: configService.getOrThrow<string>('JWT_SECRET'),
    ...issuerAudience
  };
}

/**
 * Single source of the signing and verification options, so the two can never
 * drift apart: signing stamps iss/aud and verification requires them, and a
 * mismatch would reject every token the service itself issued. Pinning the
 * algorithm keeps a token re-signed under a different one from being accepted.
 */
export function buildJwtModuleOptions(
  configService: ConfigService
): JwtModuleOptions {
  const { algorithm, key, issuer, audience } =
    buildJwtVerification(configService);
  const expiresIn = `${configService.get('JWT_EXPIRATION')}s` as StringValue;
  const signOptions = { expiresIn, algorithm, issuer, audience };
  const verifyOptions = { algorithms: [algorithm], issuer, audience };

  if (algorithm === 'RS256') {
    return {
      privateKey: decodeKey(configService, 'JWT_PRIVATE_KEY'),
      publicKey: key,
      signOptions,
      verifyOptions
    };
  }

  return { secret: key, signOptions, verifyOptions };
}

/**
 * The key-rotation floor in epoch seconds, or undefined when none is set.
 * Tokens and sessions issued before it are refused.
 */
export function readJwtMinIat(
  configService: ConfigService
): number | undefined {
  const raw = configService.get<number>('JWT_MIN_IAT');
  return raw !== undefined ? Number(raw) : undefined;
}

function decodeKey(configService: ConfigService, key: string): string {
  return Buffer.from(configService.getOrThrow<string>(key), 'base64').toString(
    'utf-8'
  );
}
