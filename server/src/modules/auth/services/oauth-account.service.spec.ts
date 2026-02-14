import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OAuthAccountService } from './oauth-account.service';
import { OAuthAccount } from '../entities/oauth-account.entity';

describe('OAuthAccountService', () => {
  let service: OAuthAccountService;
  let mockRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    mockRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthAccountService,
        {
          provide: getRepositoryToken(OAuthAccount),
          useValue: mockRepository
        }
      ]
    }).compile();

    service = module.get<OAuthAccountService>(OAuthAccountService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByProviderAndProviderId', () => {
    it('should find an OAuth account by provider and providerId', async () => {
      const mockAccount = {
        id: '1',
        provider: 'google',
        providerId: '12345',
        userId: 'user-1'
      };
      mockRepository.findOne.mockResolvedValue(mockAccount);

      const result = await service.findByProviderAndProviderId(
        'google',
        '12345'
      );

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { provider: 'google', providerId: '12345' }
      });
      expect(result).toEqual(mockAccount);
    });

    it('should return null when not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.findByProviderAndProviderId(
        'google',
        'unknown'
      );
      expect(result).toBeNull();
    });
  });

  describe('createOAuthAccount', () => {
    it('should create and save an OAuth account', async () => {
      const mockAccount = {
        id: '1',
        provider: 'google',
        providerId: '12345',
        userId: 'user-1'
      };
      mockRepository.create.mockReturnValue(mockAccount);
      mockRepository.save.mockResolvedValue(mockAccount);

      const result = await service.createOAuthAccount(
        'user-1',
        'google',
        '12345'
      );

      expect(mockRepository.create).toHaveBeenCalledWith({
        userId: 'user-1',
        provider: 'google',
        providerId: '12345'
      });
      expect(mockRepository.save).toHaveBeenCalledWith(mockAccount);
      expect(result).toEqual(mockAccount);
    });
  });

  describe('findByUserId', () => {
    it('should return all OAuth accounts for a user', async () => {
      const mockAccounts = [
        { id: '1', provider: 'google', providerId: '123', userId: 'user-1' },
        { id: '2', provider: 'facebook', providerId: '456', userId: 'user-1' }
      ];
      mockRepository.find.mockResolvedValue(mockAccounts);

      const result = await service.findByUserId('user-1');

      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' }
      });
      expect(result).toEqual(mockAccounts);
    });
  });

  describe('deleteByUserIdAndProvider', () => {
    it('should delete an OAuth account by userId and provider', async () => {
      mockRepository.delete.mockResolvedValue({ affected: 1 });

      await service.deleteByUserIdAndProvider('user-1', 'google');

      expect(mockRepository.delete).toHaveBeenCalledWith({
        userId: 'user-1',
        provider: 'google'
      });
    });
  });
});
