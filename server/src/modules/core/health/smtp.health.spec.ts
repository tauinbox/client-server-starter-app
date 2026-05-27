import { Test, TestingModule } from '@nestjs/testing';
import { SmtpHealthIndicator } from './smtp.health';
import { MailService } from '../../mail/mail.service';

describe('SmtpHealthIndicator', () => {
  let indicator: SmtpHealthIndicator;
  let mockMailService: { verifySmtp: jest.Mock };

  beforeEach(async () => {
    mockMailService = {
      verifySmtp: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmtpHealthIndicator,
        { provide: MailService, useValue: mockMailService }
      ]
    }).compile();

    indicator = module.get<SmtpHealthIndicator>(SmtpHealthIndicator);
  });

  describe('isHealthy', () => {
    it('should return healthy status when SMTP connection succeeds', async () => {
      mockMailService.verifySmtp.mockResolvedValue(undefined);

      const result = await indicator.isHealthy('smtp');

      expect(result).toEqual({ smtp: { status: 'up' } });
    });

    it('should degrade to healthy-with-warning when SMTP connection fails', async () => {
      mockMailService.verifySmtp.mockRejectedValue(
        new Error('Connection refused')
      );

      const result = await indicator.isHealthy('smtp');

      expect(result).toEqual({
        smtp: {
          status: 'up',
          warning: 'SMTP verify failed: Connection refused'
        }
      });
    });

    it('should not throw when SMTP verify rejects', async () => {
      mockMailService.verifySmtp.mockRejectedValue(new Error('Timeout'));

      await expect(indicator.isHealthy('smtp')).resolves.toEqual({
        smtp: { status: 'up', warning: 'SMTP verify failed: Timeout' }
      });
    });

    it('should stringify a non-Error rejection in the warning', async () => {
      mockMailService.verifySmtp.mockRejectedValue('EAUTH');

      const result = await indicator.isHealthy('smtp');

      expect(result).toEqual({
        smtp: { status: 'up', warning: 'SMTP verify failed: EAUTH' }
      });
    });
  });
});
