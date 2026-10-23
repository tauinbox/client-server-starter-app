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

  function sign(payload: object): string {
    return jwtService.sign(payload, { expiresIn: 3600 });
  }

  it('returns the payload of a token of the expected purpose', () => {
    const token = sign({ sub: 'user-1', purpose: TOKEN_PURPOSE.OAUTH_LINK });

    const payload = serviceWith({}).verify<{ sub: string }>(
      token,
      TOKEN_PURPOSE.OAUTH_LINK
    );

    expect(payload?.sub).toBe('user-1');
    expect(typeof payload?.iat).toBe('number');
  });

  it('refuses a token of another purpose', () => {
    const token = sign({ sub: 'user-1', purpose: TOKEN_PURPOSE.ACCESS });

    expect(serviceWith({}).verify(token, TOKEN_PURPOSE.OAUTH_LINK)).toBeNull();
  });

  it('refuses a token that does not verify', () => {
    expect(
      serviceWith({}).verify('not-a-token', TOKEN_PURPOSE.OAUTH_LINK)
    ).toBeNull();
  });

  it('refuses a token without an issue time', () => {
    const token = jwtService.sign(
      { purpose: TOKEN_PURPOSE.OAUTH_LINK },
      { noTimestamp: true }
    );

    expect(serviceWith({}).verify(token, TOKEN_PURPOSE.OAUTH_LINK)).toBeNull();
  });

  it('refuses a token issued before JWT_MIN_IAT and accepts one issued at it', () => {
    const service = serviceWith({ JWT_MIN_IAT: String(now) });

    expect(
      service.verify(
        sign({ purpose: TOKEN_PURPOSE.MFA_PENDING, iat: now - 1 }),
        TOKEN_PURPOSE.MFA_PENDING
      )
    ).toBeNull();
    expect(
      service.verify(
        sign({ purpose: TOKEN_PURPOSE.MFA_PENDING, iat: now }),
        TOKEN_PURPOSE.MFA_PENDING
      )
    ).not.toBeNull();
  });
});
