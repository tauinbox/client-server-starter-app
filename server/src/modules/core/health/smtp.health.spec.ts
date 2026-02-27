import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckError } from '@nestjs/terminus';
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

    it('should throw HealthCheckError when SMTP connection fails', async () => {
      mockMailService.verifySmtp.mockRejectedValue(
        new Error('Connection refused')
      );

      await expect(indicator.isHealthy('smtp')).rejects.toThrow(
        HealthCheckError
      );
    });

    it('should include down status in HealthCheckError when SMTP fails', async () => {
      mockMailService.verifySmtp.mockRejectedValue(new Error('Timeout'));

      try {
        await indicator.isHealthy('smtp');
        fail('Expected HealthCheckError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(HealthCheckError);
        expect((error as HealthCheckError).causes).toEqual({
          smtp: { status: 'down' }
        });
      }
    });
  });
});
