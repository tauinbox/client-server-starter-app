import { register } from 'prom-client';
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import {
  DEPENDENCY_HEALTH_REF,
  DEPENDENCY_UP_METRIC_NAME,
  createDependencyHealthRef,
  createDependencyUpGauge
} from './dependency-up.gauge';
import { SmtpHealthIndicator } from '../health/smtp.health';
import { MailService } from '../../mail/mail.service';

describe('dependency-up gauge', () => {
  afterEach(() => {
    register.removeSingleMetric(DEPENDENCY_UP_METRIC_NAME);
  });

  describe('createDependencyUpGauge', () => {
    it('emits nothing before the first readiness probe', async () => {
      const gauge = createDependencyUpGauge(createDependencyHealthRef());

      const metric = await gauge.get();

      expect(metric.values).toHaveLength(0);
    });

    it('maps each recorded dependency to 1 (healthy) or 0 (degraded)', async () => {
      const ref = createDependencyHealthRef();
      const gauge = createDependencyUpGauge(ref);
      ref.statuses.set('smtp', false);
      ref.statuses.set('redis', true);

      const metric = await gauge.get();
      const byDependency = new Map(
        metric.values.map((v) => [v.labels['dependency'], v.value])
      );

      expect(byDependency.get('smtp')).toBe(0);
      expect(byDependency.get('redis')).toBe(1);
    });

    it('reflects a recovery on the next scrape', async () => {
      const ref = createDependencyHealthRef();
      const gauge = createDependencyUpGauge(ref);

      ref.statuses.set('smtp', false);
      const degraded = await gauge.get();
      ref.statuses.set('smtp', true);
      const recovered = await gauge.get();

      expect(degraded.values[0].value).toBe(0);
      expect(recovered.values[0].value).toBe(1);
    });

    it('reuses an already-registered metric', () => {
      const first = createDependencyUpGauge(createDependencyHealthRef());
      const second = createDependencyUpGauge(createDependencyHealthRef());

      expect(second).toBe(first);
    });
  });

  // Alerting is built on the scraped text, so the assertion is made against the
  // rendered exposition rather than the gauge object.
  describe('scraped output driven by the real SMTP indicator', () => {
    let indicator: SmtpHealthIndicator;
    let mailService: { verifySmtp: jest.Mock };

    beforeEach(async () => {
      mailService = { verifySmtp: jest.fn() };
      jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const ref = createDependencyHealthRef();
      createDependencyUpGauge(ref);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SmtpHealthIndicator,
          { provide: MailService, useValue: mailService },
          { provide: DEPENDENCY_HEALTH_REF, useValue: ref }
        ]
      }).compile();

      indicator = module.get(SmtpHealthIndicator);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('flips the gauge to 0 while readiness still reports up', async () => {
      mailService.verifySmtp.mockRejectedValue(
        new Error('Invalid login: 525 5.7.13 Error: SMTP disabled')
      );

      const readiness = await indicator.isHealthy('smtp');
      const scraped = await register.metrics();

      expect(readiness).toEqual({
        smtp: { status: 'up', warning: 'SMTP verify failed' }
      });
      expect(scraped).toContain('dependency_up{dependency="smtp"} 0');
    });

    it('reports 1 when the verify succeeds', async () => {
      mailService.verifySmtp.mockResolvedValue(undefined);

      await indicator.isHealthy('smtp');
      const scraped = await register.metrics();

      expect(scraped).toContain('dependency_up{dependency="smtp"} 1');
    });
  });
});
