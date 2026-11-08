import { JwtService } from '@nestjs/jwt';
import { TOKEN_PURPOSE } from '@app/shared/constants';
import { createMockConfigService } from '../../../common/testing/config-service.mock';
import { PurposeTokenService } from './purpose-token.service';

describe('PurposeTokenService', () => {
  const jwtService = new JwtService({ secret: 'unit' });
  const now = Math.floor(Date.now() / 1000);

  function serviceWith(env: Record<string, string>): PurposeTokenService {
    return new PurposeTokenService(jwtService, createMockConfigService(env));
  }

  /** A token signed by hand, with the claims that `sign` adds. */
  function signRaw(payload: object): string {
    return jwtService.sign(
      { iatMs: Date.now(), ...payload },
      { expiresIn: 3600 }
    );
  }

  it('returns the payload of a token that it signed for the purpose', () => {
    const before = Date.now();
    const token = serviceWith({}).sign(
      { sub: 'user-1' },
      { purpose: TOKEN_PURPOSE.OAUTH_LINK, expiresIn: 60 }
    );

    const payload = serviceWith({}).verify<{ sub: string }>(
      token,
      TOKEN_PURPOSE.OAUTH_LINK
    );

    expect(payload?.sub).toBe('user-1');
    expect(typeof payload?.iat).toBe('number');
    expect(payload?.issuedAtMs).toBeGreaterThanOrEqual(before);
    expect(payload?.issuedAtMs).toBeLessThanOrEqual(Date.now());
  });

  it('signs the purpose and the lifetime it is given', () => {
    const token = serviceWith({}).sign(
      { sub: 'user-1' },
      { purpose: TOKEN_PURPOSE.MFA_PENDING, expiresIn: 60 }
    );
    const decoded = jwtService.decode<{
      purpose: string;
      iat: number;
      exp: number;
    }>(token);

    expect(decoded.purpose).toBe(TOKEN_PURPOSE.MFA_PENDING);
    expect(decoded.exp - decoded.iat).toBe(60);
  });

  it('refuses a token of another purpose', () => {
    const token = signRaw({ sub: 'user-1', purpose: TOKEN_PURPOSE.ACCESS });

    expect(serviceWith({}).verify(token, TOKEN_PURPOSE.OAUTH_LINK)).toBeNull();
  });

  it('refuses a token that does not verify', () => {
    expect(
      serviceWith({}).verify('not-a-token', TOKEN_PURPOSE.OAUTH_LINK)
    ).toBeNull();
  });

  it('refuses a token without an issue time', () => {
    const token = jwtService.sign(
      { purpose: TOKEN_PURPOSE.OAUTH_LINK, iatMs: Date.now() },
      { noTimestamp: true }
    );

    expect(serviceWith({}).verify(token, TOKEN_PURPOSE.OAUTH_LINK)).toBeNull();
  });

  // Fail closed: without milliseconds a token minted earlier in the second of
  // a revocation passes the revocation check.
  it.each([
    ['no millisecond issue time', {}],
    ['a millisecond issue time that is not a number', { iatMs: '1' }]
  ])('refuses a token with %s', (_name, claims) => {
    const token = jwtService.sign(
      { purpose: TOKEN_PURPOSE.OAUTH_DATA, ...claims },
      { expiresIn: 60 }
    );

    expect(serviceWith({}).verify(token, TOKEN_PURPOSE.OAUTH_DATA)).toBeNull();
  });

  it('refuses a token issued before JWT_MIN_IAT and accepts one issued at it', () => {
    const service = serviceWith({ JWT_MIN_IAT: String(now) });

    expect(
      service.verify(
        signRaw({ purpose: TOKEN_PURPOSE.MFA_PENDING, iat: now - 1 }),
        TOKEN_PURPOSE.MFA_PENDING
      )
    ).toBeNull();
    expect(
      service.verify(
        signRaw({ purpose: TOKEN_PURPOSE.MFA_PENDING, iat: now }),
        TOKEN_PURPOSE.MFA_PENDING
      )
    ).not.toBeNull();
  });
});
