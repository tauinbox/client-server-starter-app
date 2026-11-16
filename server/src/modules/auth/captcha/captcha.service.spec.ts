import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { isolatedConfig } from '../../../common/testing/isolated-config';
import { CaptchaService } from './captcha.service';
import { TurnstileVerifier } from './turnstile.verifier';

describe('CaptchaService', () => {
  const turnstileEnv = {
    CAPTCHA_PROVIDER: 'turnstile',
    TURNSTILE_SITE_KEY: 'site-123',
    TURNSTILE_SECRET_KEY: 'secret-456'
  };

  async function buildService(env: Record<string, string>) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaptchaService,
        { provide: ConfigService, useValue: isolatedConfig(env) }
      ]
    }).compile();

    return module.get(CaptchaService);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('selection', () => {
    it.each([
      ['no provider', {}],
      ['an empty provider', { CAPTCHA_PROVIDER: '' }],
      [
        'keys with no provider',
        { TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' }
      ]
    ])('is disabled with %s', async (_case, env) => {
      const service = await buildService(env);

      expect(service.isEnabled()).toBe(false);
      expect(service.getConfig()).toEqual({
        enabled: false,
        provider: null,
        siteKey: null
      });
    });

    it('selects Turnstile by CAPTCHA_PROVIDER and exposes only the site key', async () => {
      const service = await buildService(turnstileEnv);

      expect(service.isEnabled()).toBe(true);
      expect(service.getConfig()).toEqual({
        enabled: true,
        provider: 'turnstile',
        siteKey: 'site-123'
      });
    });
  });

  describe('verify', () => {
    it('returns true without a vendor call when no provider is selected', async () => {
      const verify = jest.spyOn(TurnstileVerifier.prototype, 'verify');
      const service = await buildService({});

      await expect(service.verify('any-token')).resolves.toBe(true);
      expect(verify).not.toHaveBeenCalled();
    });

    it('returns false on an empty token without a vendor call', async () => {
      const verify = jest.spyOn(TurnstileVerifier.prototype, 'verify');
      const service = await buildService(turnstileEnv);

      await expect(service.verify('')).resolves.toBe(false);
      expect(verify).not.toHaveBeenCalled();
    });

    it.each([true, false])(
      'returns the answer %s of the selected provider',
      async (answer) => {
        const verify = jest
          .spyOn(TurnstileVerifier.prototype, 'verify')
          .mockResolvedValue(answer);
        const service = await buildService(turnstileEnv);

        await expect(service.verify('token', '203.0.113.5')).resolves.toBe(
          answer
        );
        expect(verify).toHaveBeenCalledWith('token', '203.0.113.5');
      }
    );
  });
});
