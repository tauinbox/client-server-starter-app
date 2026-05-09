import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CaptchaService } from './captcha.service';

describe('CaptchaService', () => {
  let originalFetch: typeof fetch;
  let mockFetch: jest.Mock;

  async function buildService(env: Record<string, string | undefined>) {
    const mockConfigService = {
      get: (key: string) => env[key]
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaptchaService,
        { provide: ConfigService, useValue: mockConfigService }
      ]
    }).compile();
    return module.get(CaptchaService);
  }

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('isEnabled / getSiteKey', () => {
    it('disabled when both keys are missing', async () => {
      const service = await buildService({});
      expect(service.isEnabled()).toBe(false);
      expect(service.getSiteKey()).toBeNull();
    });

    it('disabled when only one key is set', async () => {
      const a = await buildService({ TURNSTILE_SITE_KEY: 'site' });
      expect(a.isEnabled()).toBe(false);
      const b = await buildService({ TURNSTILE_SECRET_KEY: 'secret' });
      expect(b.isEnabled()).toBe(false);
    });

    it('enabled when both keys are set, exposes only the site key', async () => {
      const service = await buildService({
        TURNSTILE_SITE_KEY: 'site-123',
        TURNSTILE_SECRET_KEY: 'secret-456'
      });
      expect(service.isEnabled()).toBe(true);
      expect(service.getSiteKey()).toBe('site-123');
    });
  });

  describe('verify', () => {
    it('returns true without calling Turnstile when service is disabled', async () => {
      const service = await buildService({});
      await expect(service.verify('any-token')).resolves.toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns false on empty token when enabled', async () => {
      const service = await buildService({
        TURNSTILE_SITE_KEY: 'site',
        TURNSTILE_SECRET_KEY: 'secret'
      });
      await expect(service.verify('')).resolves.toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('POSTs secret + token + remoteip and returns true on success', async () => {
      const service = await buildService({
        TURNSTILE_SITE_KEY: 'site',
        TURNSTILE_SECRET_KEY: 'secret-123'
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      await expect(service.verify('user-token', '203.0.113.5')).resolves.toBe(
        true
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [
        string,
        { body: string; method: string }
      ];
      expect(url).toBe(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify'
      );
      expect(init.method).toBe('POST');
      const params = new URLSearchParams(init.body);
      expect(params.get('secret')).toBe('secret-123');
      expect(params.get('response')).toBe('user-token');
      expect(params.get('remoteip')).toBe('203.0.113.5');
    });

    it('returns false when Turnstile responds with success=false', async () => {
      const service = await buildService({
        TURNSTILE_SITE_KEY: 'site',
        TURNSTILE_SECRET_KEY: 'secret'
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: false,
            'error-codes': ['invalid-input-response']
          })
      });
      await expect(service.verify('bad')).resolves.toBe(false);
    });

    it('returns false on non-2xx siteverify HTTP response', async () => {
      const service = await buildService({
        TURNSTILE_SITE_KEY: 'site',
        TURNSTILE_SECRET_KEY: 'secret'
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({})
      });
      await expect(service.verify('token')).resolves.toBe(false);
    });

    it('fails closed (returns false) on network error', async () => {
      const service = await buildService({
        TURNSTILE_SITE_KEY: 'site',
        TURNSTILE_SECRET_KEY: 'secret'
      });
      mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));
      await expect(service.verify('token')).resolves.toBe(false);
    });
  });
});
