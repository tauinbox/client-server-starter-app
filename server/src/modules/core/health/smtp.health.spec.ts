import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { SmtpHealthIndicator } from './smtp.health';
import { MailService } from '../../mail/mail.service';

describe('SmtpHealthIndicator', () => {
  let indicator: SmtpHealthIndicator;
  let mockMailService: { verifySmtp: jest.Mock };
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockMailService = {
      verifySmtp: jest.fn()
    };
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmtpHealthIndicator,
        { provide: MailService, useValue: mockMailService }
      ]
    }).compile();

    indicator = module.get<SmtpHealthIndicator>(SmtpHealthIndicator);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isHealthy', () => {
    it('should return healthy status when SMTP connection succeeds', async () => {
      mockMailService.verifySmtp.mockResolvedValue(undefined);

      const result = await indicator.isHealthy('smtp');

      expect(result).toEqual({ smtp: { status: 'up' } });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should degrade to healthy-with-warning when SMTP connection fails', async () => {
      mockMailService.verifySmtp.mockRejectedValue(
        new Error('Connection refused')
      );

      const result = await indicator.isHealthy('smtp');

      expect(result).toEqual({
        smtp: { status: 'up', warning: 'SMTP verify failed' }
      });
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
});
