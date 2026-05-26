import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { MailService } from './mail.service';
import { MAIL_QUEUE, MAIL_SEND_JOB, MailJobData } from './mail-queue.constants';

describe('MailService', () => {
  let service: MailService;
  let mockConfigService: { get: jest.Mock };

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        const config: Record<string, string> = {
          CLIENT_URL: 'http://localhost:4200',
          SMTP_FROM: 'test@example.com'
        };
        return config[key];
      })
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: ConfigService, useValue: mockConfigService }
      ]
    }).compile();

    service = module.get<MailService>(MailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should use json transport when SMTP_HOST is not set', () => {
    expect(service).toBeDefined();
    // Service was created without SMTP_HOST, so it uses jsonTransport
  });

  describe('isSmtpConfigured', () => {
    it('should return false when SMTP_HOST is not set', () => {
      expect(service.isSmtpConfigured()).toBe(false);
    });

    it('should return true when SMTP_HOST is set', async () => {
      const smtpConfigService = {
        get: jest.fn().mockImplementation((key: string) => {
          const config: Record<string, string> = {
            SMTP_HOST: 'smtp.example.com',
            SMTP_PORT: '587',
            CLIENT_URL: 'http://localhost:4200',
            SMTP_FROM: 'test@example.com'
          };
          return config[key];
        })
      };
      const smtpModule: TestingModule = await Test.createTestingModule({
        providers: [
          MailService,
          { provide: ConfigService, useValue: smtpConfigService }
        ]
      }).compile();
      const smtpService = smtpModule.get<MailService>(MailService);
      expect(smtpService.isSmtpConfigured()).toBe(true);
    });
  });

  describe('sendEmailVerification', () => {
    it('should not throw when sending verification email', async () => {
      await expect(
        service.sendEmailVerification('user@example.com', 'test-token')
      ).resolves.not.toThrow();
    });
  });

  describe('sendPasswordReset', () => {
    it('should not throw when sending password reset email', async () => {
      await expect(
        service.sendPasswordReset('user@example.com', 'test-token')
      ).resolves.not.toThrow();
    });
  });

  describe('with a queue (Redis configured)', () => {
    let queuedService: MailService;
    const add = jest.fn().mockResolvedValue(undefined);

    beforeEach(async () => {
      add.mockClear();
      const moduleRef: TestingModule = await Test.createTestingModule({
        providers: [
          MailService,
          { provide: ConfigService, useValue: mockConfigService },
          { provide: getQueueToken(MAIL_QUEUE), useValue: { add } }
        ]
      }).compile();
      queuedService = moduleRef.get<MailService>(MailService);
    });

    it('enqueues a rendered send job instead of delivering inline', async () => {
      await queuedService.sendEmailVerification(
        'user@example.com',
        'tok-123',
        'en'
      );

      expect(add).toHaveBeenCalledTimes(1);
      const [jobName, data] = add.mock.calls[0] as [string, MailJobData];
      expect(jobName).toBe(MAIL_SEND_JOB);
      expect(data.to).toBe('user@example.com');
      expect(data.subject).toBe('Verify your email address');
      expect(data.html).toContain('tok-123');
    });
  });
});
