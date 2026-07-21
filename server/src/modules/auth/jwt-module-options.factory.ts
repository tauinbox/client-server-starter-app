import type { JwtModuleOptions } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import { JWT_AUDIENCE, JWT_ISSUER } from '@app/shared/constants/auth.constants';

/**
 * Single source of the signing and verification options, so the two can never
 * drift apart: signing stamps iss/aud and verification requires them, and a
 * mismatch would reject every token the service itself issued. Pinning the
 * algorithm keeps a token re-signed under a different one from being accepted.
 */
export function buildJwtModuleOptions(
  configService: ConfigService
): JwtModuleOptions {
  const algorithm = configService.get<string>('JWT_ALGORITHM') ?? 'HS256';
  const expiresIn = `${configService.get('JWT_EXPIRATION')}s` as StringValue;
  const issuerAudience = { issuer: JWT_ISSUER, audience: JWT_AUDIENCE };

  if (algorithm === 'RS256') {
    return {
      privateKey: decodeKey(configService, 'JWT_PRIVATE_KEY'),
      publicKey: decodeKey(configService, 'JWT_PUBLIC_KEY'),
      signOptions: { expiresIn, algorithm: 'RS256', ...issuerAudience },
      verifyOptions: { algorithms: ['RS256'], ...issuerAudience }
    };
  }

  return {
    secret: configService.getOrThrow<string>('JWT_SECRET'),
    signOptions: { expiresIn, algorithm: 'HS256', ...issuerAudience },
    verifyOptions: { algorithms: ['HS256'], ...issuerAudience }
  };
}

function decodeKey(configService: ConfigService, key: string): string {
  return Buffer.from(configService.getOrThrow<string>(key), 'base64').toString(
    'utf-8'
  );
}
