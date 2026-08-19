import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { CaptchaService } from './captcha.service';
import { AuthApiEnum } from '../constants/auth-api.const';

describe('CaptchaService', () => {
  let service: CaptchaService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CaptchaService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(CaptchaService);
    httpMock = TestBed.inject(HttpTestingController);

    document
      .querySelectorAll('script#cf-turnstile-script')
      .forEach((s) => s.remove());
    delete (window as { turnstile?: unknown }).turnstile;
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('loadConfig', () => {
    it('GETs /captcha-config and caches the response', async () => {
      const promise = service.loadConfig();
      const req = httpMock.expectOne(AuthApiEnum.CaptchaConfig);
      expect(req.request.method).toBe('GET');
      req.flush({
        enabled: true,
        provider: 'turnstile',
        siteKey: 'site-1'
      });

      await expect(promise).resolves.toEqual({
        enabled: true,
        provider: 'turnstile',
        siteKey: 'site-1'
      });

      // Cached — no second HTTP call
      const second = await service.loadConfig();
      expect(second.siteKey).toBe('site-1');
      httpMock.expectNone(AuthApiEnum.CaptchaConfig);
    });

    it('coalesces concurrent requests into a single HTTP call', async () => {
      const a = service.loadConfig();
      const b = service.loadConfig();

      const req = httpMock.expectOne(AuthApiEnum.CaptchaConfig);
      req.flush({ enabled: false, provider: 'turnstile', siteKey: null });

      await expect(a).resolves.toEqual(await b);
    });

    it('retries after a failed fetch instead of latching the captcha off', async () => {
      const first = service.loadConfig();
      httpMock
        .expectOne(AuthApiEnum.CaptchaConfig)
        .flush('boom', { status: 500, statusText: 'Server Error' });

      await expect(first).rejects.toBeDefined();
      expect(service.config()).toBeNull();

      const second = service.loadConfig();
      httpMock.expectOne(AuthApiEnum.CaptchaConfig).flush({
        enabled: true,
        provider: 'turnstile',
        siteKey: 'site-1'
      });

      await expect(second).resolves.toEqual({
        enabled: true,
        provider: 'turnstile',
        siteKey: 'site-1'
      });
      expect(service.config()?.enabled).toBe(true);
    });
  });

  describe('loadScript', () => {
    it('appends the Turnstile script and resolves with the global API', async () => {
      const fakeApi = {
        render: vi.fn(),
        reset: vi.fn(),
        remove: vi.fn(),
        getResponse: vi.fn()
      };
      const loadPromise = service.loadScript();

      // The script tag must be appended synchronously
      const script = document.getElementById(
        'cf-turnstile-script'
      ) as HTMLScriptElement | null;
      expect(script).toBeTruthy();
      expect(script?.src).toContain(
        'https://challenges.cloudflare.com/turnstile/v0/api.js'
      );

      // Simulate Turnstile script finishing
      (window as { turnstile?: unknown }).turnstile = fakeApi;
      script?.dispatchEvent(new Event('load'));

      await expect(loadPromise).resolves.toBe(fakeApi);
    });

    it('returns the same promise on repeated calls', () => {
      const a = service.loadScript();
      const b = service.loadScript();
      expect(a).toBe(b);
    });

    it('starts a fresh attempt after a failed load on a pre-existing tag', async () => {
      const stale = document.createElement('script');
      stale.id = 'cf-turnstile-script';
      document.head.appendChild(stale);

      const first = service.loadScript();
      stale.dispatchEvent(new Event('error'));

      await expect(first).rejects.toThrow('Failed to load Turnstile script');
      expect(document.getElementById('cf-turnstile-script')).toBeNull();

      const second = service.loadScript();
      expect(second).not.toBe(first);

      const fresh = document.getElementById(
        'cf-turnstile-script'
      ) as HTMLScriptElement | null;
      expect(fresh).toBeTruthy();
      expect(fresh).not.toBe(stale);

      const fakeApi = {
        render: vi.fn(),
        reset: vi.fn(),
        remove: vi.fn(),
        getResponse: vi.fn()
      };
      (window as { turnstile?: unknown }).turnstile = fakeApi;
      fresh?.dispatchEvent(new Event('load'));

      await expect(second).resolves.toBe(fakeApi);
    });
  });
});
