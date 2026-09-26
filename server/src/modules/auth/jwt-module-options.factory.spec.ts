import { generateKeyPairSync } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';
import {
  buildJwtModuleOptions,
  buildJwtVerification,
  readJwtMinIat
} from './jwt-module-options.factory';

function configOf(values: Record<string, unknown>): ConfigService {
  const config: Pick<ConfigService, 'get' | 'getOrThrow'> = {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (values[key] === undefined) throw new Error(`Missing: ${key}`);
      return values[key];
    }
  };
  // @ts-expect-error a two-method stand-in for the full ConfigService
  return config;
}

function base64(pem: string): string {
  return Buffer.from(pem, 'utf-8').toString('base64');
}

describe('jwt-module-options.factory', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const configs = {
    HS256: configOf({
      JWT_ALGORITHM: 'HS256',
      JWT_SECRET: 'test-secret',
      JWT_EXPIRATION: 900
    }),
    RS256: configOf({
      JWT_ALGORITHM: 'RS256',
      JWT_PUBLIC_KEY: base64(publicKey),
      JWT_PRIVATE_KEY: base64(privateKey),
      JWT_EXPIRATION: 900
    })
  };

  it.each(Object.entries(configs))(
    'the strategy options accept a token signed with the module options (%s)',
    (algorithm, config) => {
      const token = new JwtService(buildJwtModuleOptions(config)).sign({
        sub: 'user-1'
      });
      const verification = buildJwtVerification(config);

      expect(verification.algorithm).toBe(algorithm);
      expect(() =>
        verify(token, verification.key, {
          algorithms: [verification.algorithm],
          issuer: verification.issuer,
          audience: verification.audience
        })
      ).not.toThrow();
    }
  );

  it('decodes the base64 public key for RS256', () => {
    expect(buildJwtVerification(configs.RS256).key).toBe(publicKey);
  });

  it('reads JWT_MIN_IAT as a number, and undefined when unset', () => {
    expect(readJwtMinIat(configOf({ JWT_MIN_IAT: '1700000000' }))).toBe(
      1700000000
    );
    expect(readJwtMinIat(configOf({}))).toBeUndefined();
  });
});
