import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import { SmtpHealthIndicator } from './smtp.health';
import { RedisHealthIndicator } from './redis.health';
import { MailService } from '../../mail/mail.service';

describe('HealthController', () => {
  let controller: HealthController;
  let healthServiceMock: { check: jest.Mock };
  let dbMock: { pingCheck: jest.Mock };
  let smtpMock: { isHealthy: jest.Mock };
  let redisMock: { isHealthy: jest.Mock };
  let mailServiceMock: { isSmtpConfigured: jest.Mock };
  let configMock: { get: jest.Mock };

  beforeEach(async () => {
    healthServiceMock = {
      check: jest
        .fn()
        .mockResolvedValue({ status: 'ok', info: {}, details: {} })
    };

    dbMock = {
      pingCheck: jest.fn().mockResolvedValue({ database: { status: 'up' } })
    };

    smtpMock = {
      isHealthy: jest.fn().mockResolvedValue({ smtp: { status: 'up' } })
    };

    redisMock = {
      isHealthy: jest.fn().mockReturnValue({ redis: { status: 'up' } })
    };

    mailServiceMock = {
      isSmtpConfigured: jest.fn().mockReturnValue(false)
    };

    configMock = {
      get: jest.fn().mockReturnValue('local')
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: healthServiceMock },
        { provide: TypeOrmHealthIndicator, useValue: dbMock },
        { provide: SmtpHealthIndicator, useValue: smtpMock },
        { provide: RedisHealthIndicator, useValue: redisMock },
        { provide: MailService, useValue: mailServiceMock },
        { provide: ConfigService, useValue: configMock }
      ]
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('live', () => {
    it('should return { status: "ok" }', () => {
      expect(controller.live()).toEqual({ status: 'ok' });
    });
  });

  describe('ready', () => {
    it('should call health.check with db ping when not production and SMTP not configured', () => {
      configMock.get.mockReturnValue('local');
      mailServiceMock.isSmtpConfigured.mockReturnValue(false);

      void controller.ready();

      const [[checks]] = healthServiceMock.check.mock.calls as [
        [(() => unknown)[]]
      ];
      expect(checks).toHaveLength(1);
    });

    it('should include Redis check when environment is production', () => {
      configMock.get.mockReturnValue('production');
      mailServiceMock.isSmtpConfigured.mockReturnValue(false);

      void controller.ready();

      const [[checks]] = healthServiceMock.check.mock.calls as [
        [(() => unknown)[]]
      ];
      expect(checks).toHaveLength(2);
    });

    it('should not include Redis check when environment is not production', () => {
      configMock.get.mockReturnValue('development');
      mailServiceMock.isSmtpConfigured.mockReturnValue(false);

      void controller.ready();

      const [[checks]] = healthServiceMock.check.mock.calls as [
        [(() => unknown)[]]
      ];
      expect(checks).toHaveLength(1);
    });

    it('should include SMTP check when SMTP is configured', () => {
      configMock.get.mockReturnValue('local');
      mailServiceMock.isSmtpConfigured.mockReturnValue(true);

      void controller.ready();

      const [[checks]] = healthServiceMock.check.mock.calls as [
        [(() => unknown)[]]
      ];
      expect(checks).toHaveLength(2);
    });

    it('should include Redis and SMTP checks when production and SMTP configured', () => {
      configMock.get.mockReturnValue('production');
      mailServiceMock.isSmtpConfigured.mockReturnValue(true);

      void controller.ready();

      const [[checks]] = healthServiceMock.check.mock.calls as [
        [(() => unknown)[]]
      ];
      expect(checks).toHaveLength(3);
    });
  });
});
