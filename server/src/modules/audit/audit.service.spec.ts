import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';

describe('AuditService', () => {
  let service: AuditService;
  let mockRepository: {
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
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
        }
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
  });
});
