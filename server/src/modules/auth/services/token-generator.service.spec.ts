import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TokenGeneratorService } from './token-generator.service';

describe('TokenGeneratorService', () => {
  let service: TokenGeneratorService;
  let jwtService: Pick<JwtService, 'sign'> & { sign: jest.Mock };
  let configService: Pick<ConfigService, 'getOrThrow'> & {
    getOrThrow: jest.Mock;
  };

  beforeEach(() => {
    jwtService = { sign: jest.fn().mockReturnValue('signed-jwt') };
    configService = { getOrThrow: jest.fn().mockReturnValue('3600') };
    // @ts-expect-error partial JwtService/ConfigService mocks
    service = new TokenGeneratorService(jwtService, configService);
  });

  it('signs JWT with correct payload and expiration', () => {
    const result = service.generateTokens('user-1', 'a@b.c', ['admin']);

    expect(configService.getOrThrow).toHaveBeenCalledWith('JWT_EXPIRATION');
    expect(jwtService.sign).toHaveBeenCalledWith(
      { sub: 'user-1', email: 'a@b.c', roles: ['admin'] },
      { expiresIn: 3600 }
    );
    expect(result.access_token).toBe('signed-jwt');
    expect(result.expires_in).toBe(3600);
  });

  it('generates a refresh token of 80 hex chars (40 random bytes)', () => {
    const { refresh_token } = service.generateTokens('u', 'e', []);
    expect(refresh_token).toMatch(/^[a-f0-9]{80}$/);
  });

  it('produces a unique refresh token on each call', () => {
    const a = service.generateTokens('u', 'e', []).refresh_token;
    const b = service.generateTokens('u', 'e', []).refresh_token;
    expect(a).not.toBe(b);
  });
});
