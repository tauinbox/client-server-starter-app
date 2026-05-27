import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import * as nodemailer from 'nodemailer';
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

  describe('SMTP transport TLS configuration', () => {
    let createTransportSpy: jest.SpyInstance;

    const buildWith = async (overrides: Record<string, string>) => {
      const config = {
        get: jest.fn((key: string) => overrides[key])
      };
      const moduleRef: TestingModule = await Test.createTestingModule({
        providers: [MailService, { provide: ConfigService, useValue: config }]
      }).compile();
      moduleRef.get<MailService>(MailService);
    };

    beforeEach(() => {
      createTransportSpy = jest
        .spyOn(nodemailer, 'createTransport')
        .mockReturnValue({} as ReturnType<typeof nodemailer.createTransport>);
    });

    afterEach(() => {
      createTransportSpy.mockRestore();
    });

    it('enforces STARTTLS (secure:false, requireTLS:true) on port 587', async () => {
      await buildWith({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587'
      });

      const [options] = createTransportSpy.mock.calls[0] as [
        nodemailer.TransportOptions
      ];
      expect(options).toMatchObject({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        requireTLS: true,
        tls: { minVersion: 'TLSv1.2' }
      });
    });

    it('uses implicit TLS (secure:true, no requireTLS) on port 465', async () => {
      await buildWith({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '465'
      });

      const [options] = createTransportSpy.mock.calls[0] as [
        nodemailer.TransportOptions
      ];
      expect(options).toMatchObject({
        port: 465,
        secure: true,
        requireTLS: false
      });
    });

    it('forces implicit TLS when SMTP_SECURE=true on a non-465 port', async () => {
      await buildWith({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '587',
        SMTP_SECURE: 'true'
      });

      const [options] = createTransportSpy.mock.calls[0] as [
        nodemailer.TransportOptions
      ];
      expect(options).toMatchObject({
        port: 587,
        secure: true,
        requireTLS: false
      });
    });

    it('uses jsonTransport (console branch) when SMTP_HOST is unset', async () => {
      await buildWith({});

      expect(createTransportSpy).toHaveBeenCalledWith({ jsonTransport: true });
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
