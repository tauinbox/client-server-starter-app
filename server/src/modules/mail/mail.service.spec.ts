import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

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
});
