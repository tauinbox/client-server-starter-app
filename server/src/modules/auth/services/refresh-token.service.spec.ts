import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RefreshTokenService } from './refresh-token.service';
import { RefreshToken } from '../entities/refresh-token.entity';
import { hashToken } from '../../../common/utils/hash-token';

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let mockRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let mockQueryBuilder: {
    delete: jest.Mock;
    from: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  };

  beforeEach(async () => {
    mockQueryBuilder = {
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 5 })
    };

    mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: mockRepository
        }
      ]
    }).compile();

    service = module.get<RefreshTokenService>(RefreshTokenService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createRefreshToken', () => {
    it('should create and save a refresh token with hashed value', async () => {
      const mockToken = {
        id: 'token-1',
        userId: 'user-1',
        token: hashToken('raw-token'),
        expiresAt: expect.any(Date) as Date,
        revoked: false
      };
      mockRepository.create.mockReturnValue(mockToken);
      mockRepository.save.mockResolvedValue(mockToken);

      const result = await service.createRefreshToken(
        'user-1',
        'raw-token',
        3600
      );

      expect(mockRepository.create).toHaveBeenCalledWith({
        userId: 'user-1',
        token: hashToken('raw-token'),
        expiresAt: expect.any(Date) as Date
      });
      expect(mockRepository.save).toHaveBeenCalledWith(mockToken);
      expect(result).toEqual(mockToken);
    });

    it('should set expiration based on expiresIn seconds', async () => {
      mockRepository.create.mockImplementation(
        (data: Partial<RefreshToken>) => data
      );
      mockRepository.save.mockImplementation((data: Partial<RefreshToken>) =>
        Promise.resolve(data)
      );

      const before = Date.now();
      await service.createRefreshToken('user-1', 'token', 7200);
      const after = Date.now();

      const createArg = mockRepository.create.mock.calls[0] as [
        Partial<RefreshToken>
      ];
      const expiresAt = createArg[0].expiresAt as Date;
      const expectedMin = before + 7200 * 1000;
      const expectedMax = after + 7200 * 1000;

      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedMax);
    });
  });

  describe('findByToken', () => {
    it('should find a token by its hash', async () => {
      const mockToken = {
        id: 'token-1',
        token: hashToken('raw-token'),
        userId: 'user-1'
      };
      mockRepository.findOne.mockResolvedValue(mockToken);

      const result = await service.findByToken('raw-token');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { token: hashToken('raw-token') }
      });
      expect(result).toEqual(mockToken);
    });

    it('should return null when token not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.findByToken('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('deleteByUserId', () => {
    it('should delete all tokens for a user', async () => {
      mockRepository.delete.mockResolvedValue({ affected: 3 });

      await service.deleteByUserId('user-1');

      expect(mockRepository.delete).toHaveBeenCalledWith({
        userId: 'user-1'
      });
    });
  });

  describe('revokeToken', () => {
    it('should mark a token as revoked', async () => {
      mockRepository.update.mockResolvedValue({ affected: 1 });

      await service.revokeToken('token-1');

      expect(mockRepository.update).toHaveBeenCalledWith('token-1', {
        revoked: true
      });
    });
  });

  describe('countExpiredTokens', () => {
    it('should count tokens with expiresAt before now', async () => {
      mockRepository.count.mockResolvedValue(42);

      const result = await service.countExpiredTokens();

      expect(mockRepository.count).toHaveBeenCalledWith({
        where: {
          expiresAt: expect.objectContaining({
            _type: 'lessThan'
          }) as Date
        }
      });
      expect(result).toBe(42);
    });
  });

  describe('removeExpiredTokens', () => {
    it('should delete expired tokens using query builder', async () => {
      await service.removeExpiredTokens();

      expect(mockRepository.createQueryBuilder).toHaveBeenCalled();
      expect(mockQueryBuilder.delete).toHaveBeenCalled();
      expect(mockQueryBuilder.from).toHaveBeenCalledWith(RefreshToken);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('expires_at < :now', {
        now: expect.any(Date) as Date
      });
      expect(mockQueryBuilder.execute).toHaveBeenCalled();
    });
  });

  describe('removeRevokedAndExpiredTokens', () => {
    it('should delete tokens that are both revoked and expired', async () => {
      mockRepository.delete.mockResolvedValue({ affected: 10 });

      await service.removeRevokedAndExpiredTokens();

      expect(mockRepository.delete).toHaveBeenCalledWith({
        revoked: true,
        expiresAt: expect.objectContaining({
          _type: 'lessThan'
        }) as Date
      });
    });
  });

  describe('getTokenStatistics', () => {
    it('should return counts for active, expired, and revoked tokens', async () => {
      mockRepository.count
        .mockResolvedValueOnce(10) // totalActive
        .mockResolvedValueOnce(5) // totalExpired
        .mockResolvedValueOnce(3); // totalRevoked

      const result = await service.getTokenStatistics();

      expect(result).toEqual({
        totalActive: 10,
        totalExpired: 5,
        totalRevoked: 3
      });
      expect(mockRepository.count).toHaveBeenCalledTimes(3);
    });

    it('should query active tokens with non-expired and non-revoked criteria', async () => {
      mockRepository.count.mockResolvedValue(0);

      await service.getTokenStatistics();

      // First call: active tokens (not expired, not revoked)
      expect(mockRepository.count).toHaveBeenNthCalledWith(1, {
        where: {
          expiresAt: expect.objectContaining({
            _type: 'moreThan'
          }) as Date,
          revoked: false
        }
      });
    });
  });
});
