import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { HttpStatus } from '@nestjs/common';
import { ErrorKeys } from '@app/shared/constants';
import { OAuthAccountService } from './oauth-account.service';
import { OAuthAccount } from '../entities/oauth-account.entity';
import { User } from '../../users/entities/user.entity';

type TransactionalManagerStub = Pick<
  EntityManager,
  'findOne' | 'find' | 'delete'
>;

describe('OAuthAccountService', () => {
  let service: OAuthAccountService;
  let mockRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let mockManager: {
    findOne: jest.Mock;
    find: jest.Mock;
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

    mockManager = {
      findOne: jest.fn(),
      find: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 })
    };

    // Only the three manager methods `unlinkProvider` calls are stubbed, so the
    // callback is typed against that narrow slice rather than the full manager.
    const mockDataSource = {
      transaction: jest.fn(
        (operation: (manager: TransactionalManagerStub) => Promise<unknown>) =>
          operation(mockManager)
      )
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthAccountService,
        {
          provide: getRepositoryToken(OAuthAccount),
          useValue: mockRepository
        },
        {
          provide: DataSource,
          useValue: mockDataSource
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

  describe('unlinkProvider', () => {
    function stubUser(password: string | null): void {
      mockManager.findOne.mockResolvedValue({ id: 'user-1', password });
    }

    // The caller notifies the owner after the commit, so the address has to
    // come from the row this transaction read, not from the request.
    it('returns the address and locale of the account it unlinked', async () => {
      mockManager.findOne.mockResolvedValue({
        id: 'user-1',
        password: 'hashed-password',
        email: 'owner@example.com',
        locale: 'ru'
      });
      mockManager.find.mockResolvedValue([
        { provider: 'google', userId: 'user-1' }
      ]);

      await expect(service.unlinkProvider('user-1', 'google')).resolves.toEqual(
        { email: 'owner@example.com', locale: 'ru' }
      );
    });

    it('should delete the account while holding a write lock on the user row', async () => {
      stubUser(null);
      mockManager.find.mockResolvedValue([
        { provider: 'google', userId: 'user-1' },
        { provider: 'facebook', userId: 'user-1' }
      ]);

      await service.unlinkProvider('user-1', 'google');

      expect(mockManager.findOne).toHaveBeenCalledWith(User, {
        where: { id: 'user-1' },
        lock: { mode: 'pessimistic_write' }
      });
      expect(mockManager.delete).toHaveBeenCalledWith(OAuthAccount, {
        userId: 'user-1',
        provider: 'google'
      });
    });

    it('should reject unlinking the last provider of a password-less account', async () => {
      stubUser(null);
      mockManager.find.mockResolvedValue([
        { provider: 'google', userId: 'user-1' }
      ]);

      // The errorKey is the contract; the message is user-facing copy that has
      // been reworded once already.
      await expect(
        service.unlinkProvider('user-1', 'google')
      ).rejects.toMatchObject({
        response: { errorKey: ErrorKeys.AUTH.UNLINK_LAST_PROVIDER }
      });
      expect(mockManager.delete).not.toHaveBeenCalled();
    });

    it('should allow unlinking the last provider when a password is set', async () => {
      stubUser('hashed-password');
      mockManager.find.mockResolvedValue([
        { provider: 'google', userId: 'user-1' }
      ]);

      await service.unlinkProvider('user-1', 'google');

      expect(mockManager.delete).toHaveBeenCalled();
    });

    it('should 404 without deleting when the provider is not linked', async () => {
      stubUser('hashed-password');
      mockManager.find.mockResolvedValue([
        { provider: 'facebook', userId: 'user-1' }
      ]);

      await expect(
        service.unlinkProvider('user-1', 'google')
      ).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
        response: { errorKey: ErrorKeys.AUTH.OAUTH_PROVIDER_NOT_LINKED }
      });
      expect(mockManager.delete).not.toHaveBeenCalled();
    });

    it('should 404 when the user row is gone', async () => {
      mockManager.findOne.mockResolvedValue(null);

      await expect(
        service.unlinkProvider('user-1', 'google')
      ).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
        response: { errorKey: ErrorKeys.USERS.NOT_FOUND }
      });
      expect(mockManager.find).not.toHaveBeenCalled();
    });
  });
});
