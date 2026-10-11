import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingConfigService } from './billing-config.service';

describe('BillingConfigService', () => {
  const yookassaKeys = {
    YOOKASSA_SHOP_ID: 'id',
    YOOKASSA_SECRET_KEY: 'sec'
  };

  function service(env: Record<string, unknown>): BillingConfigService {
    return new BillingConfigService(new ConfigService(env));
  }

  afterEach(() => jest.restoreAllMocks());

  describe('isConfigured', () => {
    it('needs both Paddle vars and no REDIS_URL for Paddle', () => {
      expect(service({ PADDLE_API_KEY: 'k' }).isConfigured('paddle')).toBe(
        false
      );
      expect(
        service({
          PADDLE_API_KEY: 'k',
          PADDLE_WEBHOOK_SECRET: 's'
        }).isConfigured('paddle')
      ).toBe(true);
    });

    it('treats YooKassa as not configured without REDIS_URL, because nothing would renew it', () => {
      expect(service(yookassaKeys).isConfigured('yookassa')).toBe(false);
      expect(
        service({ ...yookassaKeys, REDIS_URL: '' }).isConfigured('yookassa')
      ).toBe(false);
    });

    it('treats YooKassa as configured with both keys and REDIS_URL', () => {
      expect(
        service({
          ...yookassaKeys,
          REDIS_URL: 'redis://localhost:6379'
        }).isConfigured('yookassa')
      ).toBe(true);
    });

    it('needs both YooKassa keys even with REDIS_URL', () => {
      expect(
        service({
          YOOKASSA_SHOP_ID: 'id',
          REDIS_URL: 'redis://localhost:6379'
        }).isConfigured('yookassa')
      ).toBe(false);
    });
  });

  describe('onModuleInit', () => {
    function warnSpy(): jest.SpyInstance {
      return jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    }

    it('warns once when the YooKassa keys are set without REDIS_URL', () => {
      const warn = warnSpy();
      service(yookassaKeys).onModuleInit();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('REDIS_URL'));
    });

    it('does not warn when REDIS_URL is set', () => {
      const warn = warnSpy();
      service({
        ...yookassaKeys,
        REDIS_URL: 'redis://localhost:6379'
      }).onModuleInit();
      expect(warn).not.toHaveBeenCalled();
    });

    it('does not warn when YooKassa is not set up', () => {
      const warn = warnSpy();
      service({}).onModuleInit();
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
