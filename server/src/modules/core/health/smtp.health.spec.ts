import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { SmtpHealthIndicator } from './smtp.health';
import { MailService } from '../../mail/mail.service';
import {
  DEPENDENCY_HEALTH_REF,
  DependencyHealthRef,
  createDependencyHealthRef
} from '../metrics/dependency-up.gauge';

describe('SmtpHealthIndicator', () => {
  let indicator: SmtpHealthIndicator;
  let mockMailService: { verifySmtp: jest.Mock };
  let dependencyHealth: DependencyHealthRef;
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockMailService = {
      verifySmtp: jest.fn()
    };
    dependencyHealth = createDependencyHealthRef();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmtpHealthIndicator,
        { provide: MailService, useValue: mockMailService },
        { provide: DEPENDENCY_HEALTH_REF, useValue: dependencyHealth }
      ]
    }).compile();

    indicator = module.get<SmtpHealthIndicator>(SmtpHealthIndicator);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('isHealthy', () => {
    it('should return healthy status when SMTP connection succeeds', async () => {
      mockMailService.verifySmtp.mockResolvedValue(undefined);

      const result = await indicator.isHealthy('smtp');

      expect(result).toEqual({ smtp: { status: 'up' } });
      expect(warnSpy).not.toHaveBeenCalled();
      expect(dependencyHealth.statuses.get('smtp')).toBe(true);
    });

    it('should degrade to healthy-with-warning when SMTP connection fails', async () => {
      mockMailService.verifySmtp.mockRejectedValue(
        new Error('Connection refused')
      );

      const result = await indicator.isHealthy('smtp');

      expect(result).toEqual({
        smtp: { status: 'up', warning: 'SMTP verify failed' }
      });
      expect(dependencyHealth.statuses.get('smtp')).toBe(false);
    });

    it('should not leak the SMTP error detail into the public warning', async () => {
      mockMailService.verifySmtp.mockRejectedValue(
        new Error('connect ECONNREFUSED smtp.internal.example:465')
      );

      const result = await indicator.isHealthy('smtp');

      expect(JSON.stringify(result)).not.toContain('smtp.internal.example');
      expect(result).toEqual({
        smtp: { status: 'up', warning: 'SMTP verify failed' }
      });
    });

    it('should log the failure detail server-side', async () => {
      mockMailService.verifySmtp.mockRejectedValue(
        new Error('Connection refused')
      );

      await indicator.isHealthy('smtp');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Connection refused')
      );
    });

    it('should not throw when SMTP verify rejects', async () => {
      mockMailService.verifySmtp.mockRejectedValue(new Error('Timeout'));

      await expect(indicator.isHealthy('smtp')).resolves.toEqual({
        smtp: { status: 'up', warning: 'SMTP verify failed' }
      });
    });

    it('should log a stringified non-Error rejection', async () => {
      mockMailService.verifySmtp.mockRejectedValue('EAUTH');

      const result = await indicator.isHealthy('smtp');

      expect(result).toEqual({
        smtp: { status: 'up', warning: 'SMTP verify failed' }
      });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('EAUTH'));
    });
  });

  describe('verify caching', () => {
    const TTL_MS = 5 * 60 * 1000;
    const HEALTHCHECK_INTERVAL_MS = 30 * 1000;

    it('should verify once for repeated probes inside the TTL', async () => {
      jest.useFakeTimers();
      mockMailService.verifySmtp.mockResolvedValue(undefined);

      for (let i = 0; i < 10; i++) {
        await indicator.isHealthy('smtp');
        jest.advanceTimersByTime(HEALTHCHECK_INTERVAL_MS);
      }

      expect(mockMailService.verifySmtp).toHaveBeenCalledTimes(1);
    });

    it('should cache a failure so a dead SMTP is not re-probed every 30s', async () => {
      jest.useFakeTimers();
      mockMailService.verifySmtp.mockRejectedValue(
        new Error('Invalid login: 525 5.7.13 Error: SMTP disabled')
      );

      const first = await indicator.isHealthy('smtp');
      jest.advanceTimersByTime(HEALTHCHECK_INTERVAL_MS);
      const second = await indicator.isHealthy('smtp');

      expect(mockMailService.verifySmtp).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
      expect(second).toEqual({
        smtp: { status: 'up', warning: 'SMTP verify failed' }
      });
    });

    it('should re-verify once the TTL expires, so a recovery surfaces', async () => {
      jest.useFakeTimers();
      mockMailService.verifySmtp.mockRejectedValueOnce(new Error('EAUTH'));

      const failed = await indicator.isHealthy('smtp');
      jest.advanceTimersByTime(TTL_MS);
      const recovered = await indicator.isHealthy('smtp');

      expect(mockMailService.verifySmtp).toHaveBeenCalledTimes(2);
      expect(failed).toEqual({
        smtp: { status: 'up', warning: 'SMTP verify failed' }
      });
      expect(recovered).toEqual({ smtp: { status: 'up' } });
      expect(dependencyHealth.statuses.get('smtp')).toBe(true);
    });

    it('should issue a single verify for concurrent probes', async () => {
      let releaseVerify!: () => void;
      mockMailService.verifySmtp.mockReturnValue(
        new Promise<void>((resolve) => {
          releaseVerify = resolve;
        })
      );

      const probes = Promise.all([
        indicator.isHealthy('smtp'),
        indicator.isHealthy('smtp'),
        indicator.isHealthy('smtp'),
        indicator.isHealthy('smtp')
      ]);
      releaseVerify();
      const results = await probes;

      expect(mockMailService.verifySmtp).toHaveBeenCalledTimes(1);
      expect(results).toEqual([
        { smtp: { status: 'up' } },
        { smtp: { status: 'up' } },
        { smtp: { status: 'up' } },
        { smtp: { status: 'up' } }
      ]);
    });
  });
});
