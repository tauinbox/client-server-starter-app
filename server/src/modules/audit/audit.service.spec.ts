import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { AUDIT_FIELD_MAX_LENGTH, AuditService } from './audit.service';
import { MetricsService } from '../core/metrics/metrics.service';
import { AuditLog } from './entities/audit-log.entity';

describe('AuditService', () => {
  let service: AuditService;
  let mockRepository: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let mockMetrics: jest.Mocked<Pick<MetricsService, 'recordAuditWriteFailure'>>;

  beforeEach(async () => {
    mockMetrics = { recordAuditWriteFailure: jest.fn() };
    mockRepository = {
      create: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) => data),
      save: jest.fn().mockResolvedValue(undefined)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: getRepositoryToken(AuditLog),
          useValue: mockRepository
        },
        { provide: MetricsService, useValue: mockMetrics }
      ]
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('log', () => {
    it('should persist an audit entry with all fields', async () => {
      await service.log({
        action: AuditAction.USER_LOGIN_SUCCESS,
        actorId: 'user-1',
        actorEmail: 'test@example.com',
        targetId: 'user-1',
        targetType: 'User',
        details: { source: 'self' },
        context: { ip: '127.0.0.1', requestId: 'req-123' }
      });

      expect(mockRepository.create).toHaveBeenCalledWith({
        action: AuditAction.USER_LOGIN_SUCCESS,
        actorId: 'user-1',
        actorEmail: 'test@example.com',
        targetId: 'user-1',
        targetType: 'User',
        details: { source: 'self' },
        ipAddress: '127.0.0.1',
        requestId: 'req-123'
      });
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should set nulls for missing optional fields', async () => {
      await service.log({
        action: AuditAction.TOKEN_REFRESH_FAILURE
      });

      expect(mockRepository.create).toHaveBeenCalledWith({
        action: AuditAction.TOKEN_REFRESH_FAILURE,
        actorId: null,
        actorEmail: null,
        targetId: null,
        targetType: null,
        details: null,
        ipAddress: null,
        requestId: null
      });
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('writes through the transaction of a given manager', async () => {
      const txRepository = {
        create: jest.fn((data: Record<string, unknown>) => data),
        save: jest.fn().mockResolvedValue(undefined)
      };
      const manager = { getRepository: jest.fn(() => txRepository) };

      await service.log(
        { action: AuditAction.FEATURE_FLAG_UPDATE },
        // @ts-expect-error a manager that implements only getRepository
        manager
      );

      expect(manager.getRepository).toHaveBeenCalledWith(AuditLog);
      expect(txRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.FEATURE_FLAG_UPDATE })
      );
      expect(mockRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('log - field caps', () => {
    it('truncates an over-long actorEmail to the stated cap', async () => {
      const actorEmail = `${'a'.repeat(400)}@example.com`;

      await service.log({
        action: AuditAction.USER_LOGIN_FAILURE,
        actorEmail
      });

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          actorEmail: actorEmail.slice(0, AUDIT_FIELD_MAX_LENGTH)
        })
      );
    });

    it('truncates requestId, targetId, targetType and ip as well', async () => {
      await service.log({
        action: AuditAction.USER_LOGIN_FAILURE,
        targetId: 'i'.repeat(5000),
        targetType: 't'.repeat(5000),
        context: { ip: 'p'.repeat(5000), requestId: 'r'.repeat(5000) }
      });

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          targetId: 'i'.repeat(AUDIT_FIELD_MAX_LENGTH),
          targetType: 't'.repeat(AUDIT_FIELD_MAX_LENGTH),
          ipAddress: 'p'.repeat(AUDIT_FIELD_MAX_LENGTH),
          requestId: 'r'.repeat(AUDIT_FIELD_MAX_LENGTH)
        })
      );
    });

    it('leaves a value at the cap untouched', async () => {
      const actorEmail = 'a'.repeat(AUDIT_FIELD_MAX_LENGTH);

      await service.log({
        action: AuditAction.USER_LOGIN_FAILURE,
        actorEmail
      });

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ actorEmail })
      );
    });
  });

  describe('logFireAndForget', () => {
    it('should not throw on DB error', async () => {
      mockRepository.save.mockRejectedValue(new Error('DB connection lost'));

      expect(() =>
        service.logFireAndForget({
          action: AuditAction.USER_LOGIN_FAILURE,
          actorEmail: 'test@example.com'
        })
      ).not.toThrow();

      // Wait for the async operation to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('counts a lost row under its action', async () => {
      mockRepository.save.mockRejectedValue(new Error('DB connection lost'));

      service.logFireAndForget({ action: AuditAction.MFA_DISABLE });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockMetrics.recordAuditWriteFailure).toHaveBeenCalledWith(
        AuditAction.MFA_DISABLE
      );
    });

    it('does not count a row that was written', async () => {
      service.logFireAndForget({ action: AuditAction.MFA_DISABLE });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockMetrics.recordAuditWriteFailure).not.toHaveBeenCalled();
    });
  });
});
