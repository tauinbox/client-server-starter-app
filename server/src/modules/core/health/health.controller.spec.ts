import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { SmtpHealthIndicator } from './smtp.health';
import { MailService } from '../../mail/mail.service';

describe('HealthController', () => {
  let controller: HealthController;
  let healthServiceMock: { check: jest.Mock };
  let dbMock: { pingCheck: jest.Mock };
  let smtpMock: { isHealthy: jest.Mock };
  let mailServiceMock: { isSmtpConfigured: jest.Mock };

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

    mailServiceMock = {
      isSmtpConfigured: jest.fn().mockReturnValue(false)
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: healthServiceMock },
        { provide: TypeOrmHealthIndicator, useValue: dbMock },
        { provide: SmtpHealthIndicator, useValue: smtpMock },
        { provide: MailService, useValue: mailServiceMock }
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
    it('should call health.check with db ping when SMTP is not configured', () => {
      mailServiceMock.isSmtpConfigured.mockReturnValue(false);

      void controller.ready();

      expect(healthServiceMock.check).toHaveBeenCalledWith(
        expect.arrayContaining([expect.any(Function)])
      );
    });

    it('should include SMTP check when SMTP is configured', () => {
      mailServiceMock.isSmtpConfigured.mockReturnValue(true);

      void controller.ready();

      const [[checks]] = healthServiceMock.check.mock.calls as [
        [(() => unknown)[]]
      ];
      expect(checks).toHaveLength(2);
    });

    it('should not include SMTP check when SMTP is not configured', () => {
      mailServiceMock.isSmtpConfigured.mockReturnValue(false);

      void controller.ready();

      const [[checks]] = healthServiceMock.check.mock.calls as [
        [(() => unknown)[]]
      ];
      expect(checks).toHaveLength(1);
    });
  });
});
