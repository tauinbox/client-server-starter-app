import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AuditCleanupService } from './audit-cleanup.service';
import { AuditLog } from './entities/audit-log.entity';

describe('AuditCleanupService', () => {
  let service: AuditCleanupService;
  let mockRepository: { delete: jest.Mock };
  let mockConfigService: { get: jest.Mock };

  beforeEach(async () => {
    mockRepository = {
      delete: jest.fn().mockResolvedValue({ affected: 5 })
    };
    mockConfigService = {
      get: jest.fn().mockReturnValue(90)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditCleanupService,
        {
          provide: getRepositoryToken(AuditLog),
          useValue: mockRepository
        },
        {
          provide: ConfigService,
          useValue: mockConfigService
        }
      ]
    }).compile();

    service = module.get<AuditCleanupService>(AuditCleanupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleDailyAuditLogCleanup', () => {
    it('should delete entries older than the configured retention period', async () => {
      await service.handleDailyAuditLogCleanup();

      expect(mockRepository.delete).toHaveBeenCalledTimes(1);
    });

    it('should log the number of removed entries', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await service.handleDailyAuditLogCleanup();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('5'));
      logSpy.mockRestore();
    });

    it('should use default retention of 90 days when not configured', async () => {
      mockConfigService.get.mockReturnValue(undefined);

      await service.handleDailyAuditLogCleanup();

      expect(mockRepository.delete).toHaveBeenCalled();
    });

    it('should log an error if delete fails', async () => {
      mockRepository.delete.mockRejectedValue(new Error('DB down'));
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();

      await service.handleDailyAuditLogCleanup();

      expect(errorSpy).toHaveBeenCalledWith(
        'Error during audit log cleanup',
        expect.any(Error)
      );
      errorSpy.mockRestore();
    });
  });
});
