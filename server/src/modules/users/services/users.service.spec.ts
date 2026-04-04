import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, HttpException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { BCRYPT_SALT_ROUNDS } from '@app/shared/constants/auth.constants';
import { UsersService } from './users.service';
import { User } from '../entities/user.entity';
import type { AppAbility } from '../../auth/casl/app-ability';

describe('UsersService', () => {
  let service: UsersService;
  let mockRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softRemove: jest.Mock;
    restore: jest.Mock;
    merge: jest.Mock;
    createQueryBuilder: jest.Mock;
    increment: jest.Mock;
    update: jest.Mock;
  };
  let mockDataSource: { transaction: jest.Mock };
  let mockQueryBuilder: {
    leftJoinAndSelect: jest.Mock;
    withDeleted: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    getMany: jest.Mock;
    getManyAndCount: jest.Mock;
  };

  const mockUser: User = {
    id: 'user-1',
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    password: '$2b$10$hashedpassword',
    isActive: true,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    deletedAt: null
  } as User;

  beforeEach(async () => {
    mockQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0])
    };

    mockRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      softRemove: jest.fn().mockResolvedValue(undefined),
      restore: jest.fn().mockResolvedValue(undefined),
      merge: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      increment: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined)
    };

    mockDataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockRepository
        },
        {
          provide: DataSource,
          useValue: mockDataSource
        }
      ]
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createUserDto = {
      email: 'new@example.com',
      password: 'Password1',
      firstName: 'Jane',
      lastName: 'Doe'
    };

    it('should create a user with hashed password', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      mockRepository.create.mockReturnValue(mockUser);
      mockRepository.save.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);

      const result = await service.create(createUserDto);

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { email: 'new@example.com' }
      });
      expect(bcrypt.hash).toHaveBeenCalledWith('Password1', BCRYPT_SALT_ROUNDS);
      expect(mockRepository.create).toHaveBeenCalledWith({
        ...createUserDto,
        password: 'hashed'
      });
      expect(mockRepository.save).toHaveBeenCalledWith(mockUser);
      expect(result).toEqual(mockUser);
    });

    it('should throw HttpException when email already exists', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);

      await expect(service.create(createUserDto)).rejects.toThrow(
        HttpException
      );
      await expect(service.create(createUserDto)).rejects.toThrow(
        'User with this email already exists'
      );
    });
  });

  describe('findOne', () => {
    it('should return a user by id', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findOne('user-1');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        relations: ['roles']
      });
      expect(result).toEqual(mockUser);
    });

    it('should throw HttpException when user not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        HttpException
      );
      await expect(service.findOne('nonexistent')).rejects.toThrow(
        'User with ID nonexistent not found'
      );
    });
  });

  describe('findByEmail', () => {
    it('should return a user by email', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findByEmail('test@example.com');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        relations: ['roles']
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null when email not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.findByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });
  });

  describe('findPaginated', () => {
    it('should return paginated results with default params', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[mockUser], 1]);

      const result = await service.findPaginated({
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('user');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'user.createdAt',
        'DESC'
      );
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
      expect(result.data).toEqual([mockUser]);
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1
      });
    });

    it('should apply custom page and limit', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 25]);

      const result = await service.findPaginated({
        page: 3,
        limit: 5,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(5);
      expect(result.meta).toEqual({
        page: 3,
        limit: 5,
        total: 25,
        totalPages: 5
      });
    });

    it('should apply sorting', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findPaginated({
        page: 1,
        limit: 10,
        sortBy: 'email',
        sortOrder: 'asc'
      });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'user.email',
        'ASC'
      );
    });

    it('should apply filters along with pagination', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[mockUser], 1]);

      await service.findPaginated({
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        email: 'test'
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.email ILIKE :email',
        { email: '%test%' }
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalled();
      expect(mockQueryBuilder.skip).toHaveBeenCalled();
      expect(mockQueryBuilder.take).toHaveBeenCalled();
    });

    it('should return empty data with correct meta when no results', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      const result = await service.findPaginated({
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      expect(result.data).toEqual([]);
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0
      });
    });

    it('should compute totalPages correctly', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 71]);

      const result = await service.findPaginated({
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      expect(result.meta.totalPages).toBe(8);
    });

    it('should call withDeleted() when includeDeleted is true', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findPaginated({
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        includeDeleted: true
      });

      expect(mockQueryBuilder.withDeleted).toHaveBeenCalled();
    });

    it('should not call withDeleted() when includeDeleted is false', async () => {
      mockQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.findPaginated({
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        includeDeleted: false
      });

      expect(mockQueryBuilder.withDeleted).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update user fields', async () => {
      const updateDto = { firstName: 'Updated' };
      mockRepository.findOne.mockResolvedValue(mockUser);
      mockRepository.save.mockResolvedValue({ ...mockUser, ...updateDto });

      const result = await service.update('user-1', updateDto);

      expect(mockRepository.merge).toHaveBeenCalledWith(mockUser, updateDto);
      expect(mockRepository.save).toHaveBeenCalledWith(mockUser);
      expect(result.firstName).toBe('Updated');
    });

    it('should hash password when updating password', async () => {
      const updateDto = { password: 'NewPassword1' };
      mockRepository.findOne.mockResolvedValue(mockUser);
      mockRepository.save.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('new-hashed' as never);

      await service.update('user-1', updateDto);

      expect(bcrypt.hash).toHaveBeenCalledWith(
        'NewPassword1',
        BCRYPT_SALT_ROUNDS
      );
      expect(mockRepository.merge).toHaveBeenCalledWith(mockUser, {
        password: 'new-hashed'
      });
    });

    it('should throw HttpException when user not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { firstName: 'Updated' })
      ).rejects.toThrow(HttpException);
    });

    it('should unlock account when unlockAccount is true', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: 5,
        lockedUntil: new Date()
      });
      mockRepository.save.mockResolvedValue(mockUser);

      await service.update('user-1', { unlockAccount: true });

      expect(mockRepository.merge).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          failedLoginAttempts: 0,
          lockedUntil: null
        })
      );
    });

    it('should throw ForbiddenException when ability denies update', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      const canSpy = jest.fn().mockReturnValue(false);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: canSpy };

      await expect(
        service.update('user-1', { firstName: 'Updated' }, ability)
      ).rejects.toThrow(ForbiddenException);
      expect(canSpy).toHaveBeenCalledWith('update', mockUser);
    });

    it('should proceed when ability allows update', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      mockRepository.save.mockResolvedValue({
        ...mockUser,
        firstName: 'Updated'
      });
      const canSpy = jest.fn().mockReturnValue(true);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: canSpy };

      const result = await service.update(
        'user-1',
        { firstName: 'Updated' },
        ability
      );

      expect(canSpy).toHaveBeenCalledWith('update', mockUser);
      expect(result.firstName).toBe('Updated');
    });

    it('should skip ability check when ability is not provided', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      mockRepository.save.mockResolvedValue({
        ...mockUser,
        firstName: 'Updated'
      });

      const result = await service.update('user-1', { firstName: 'Updated' });

      expect(result.firstName).toBe('Updated');
    });
  });

  describe('remove', () => {
    it('should soft-delete an existing user', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      mockRepository.softRemove.mockResolvedValue(undefined);

      await service.remove('user-1');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        relations: ['roles']
      });
      expect(mockRepository.softRemove).toHaveBeenCalledWith(mockUser);
    });

    it('should throw HttpException when user not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.remove('nonexistent')).rejects.toThrow(
        HttpException
      );
    });

    it('should throw ForbiddenException when ability denies delete', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      const canSpy = jest.fn().mockReturnValue(false);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: canSpy };

      await expect(service.remove('user-1', ability)).rejects.toThrow(
        ForbiddenException
      );
      expect(canSpy).toHaveBeenCalledWith('delete', mockUser);
    });

    it('should proceed when ability allows delete', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      mockRepository.softRemove.mockResolvedValue(undefined);
      const canSpy = jest.fn().mockReturnValue(true);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: canSpy };

      await service.remove('user-1', ability);

      expect(canSpy).toHaveBeenCalledWith('delete', mockUser);
      expect(mockRepository.softRemove).toHaveBeenCalledWith(mockUser);
    });
  });

  describe('restore', () => {
    const deletedUser: User = {
      ...mockUser,
      deletedAt: new Date('2025-06-01'),
      isActive: false
    } as User;

    it('should restore a soft-deleted user inside a transaction', async () => {
      const mockManager = {
        restore: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined)
      };
      mockDataSource.transaction.mockImplementation(
        (cb: (manager: typeof mockManager) => Promise<void>) => cb(mockManager)
      );
      mockRepository.findOne
        .mockResolvedValueOnce(deletedUser) // withDeleted lookup
        .mockResolvedValueOnce(mockUser); // final findOne after restore

      const result = await service.restore('user-1');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        relations: ['roles'],
        withDeleted: true
      });
      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(mockManager.restore).toHaveBeenCalledWith(User, 'user-1');
      expect(mockManager.update).toHaveBeenCalledWith(User, 'user-1', {
        isActive: true
      });
      expect(result).toEqual(mockUser);
    });

    it('should throw HttpException when user does not exist', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.restore('nonexistent')).rejects.toThrow(
        HttpException
      );
    });

    it('should throw ForbiddenException when ability denies restore', async () => {
      mockRepository.findOne.mockResolvedValue(deletedUser);
      const canSpy = jest.fn().mockReturnValue(false);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: canSpy };

      await expect(service.restore('user-1', ability)).rejects.toThrow(
        ForbiddenException
      );
      expect(canSpy).toHaveBeenCalledWith('delete', deletedUser);
    });

    it('should proceed when ability allows restore', async () => {
      const mockManager = {
        restore: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined)
      };
      mockDataSource.transaction.mockImplementation(
        (cb: (manager: typeof mockManager) => Promise<void>) => cb(mockManager)
      );
      mockRepository.findOne
        .mockResolvedValueOnce(deletedUser)
        .mockResolvedValueOnce(mockUser);
      const canSpy = jest.fn().mockReturnValue(true);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: canSpy };

      const result = await service.restore('user-1', ability);

      expect(canSpy).toHaveBeenCalledWith('delete', deletedUser);
      expect(result).toEqual(mockUser);
    });
  });

  describe('incrementFailedAttemptsAndLockIfNeeded', () => {
    let mockUpdateQb: {
      update: jest.Mock;
      set: jest.Mock;
      where: jest.Mock;
      setParameters: jest.Mock;
      returning: jest.Mock;
      execute: jest.Mock;
    };

    beforeEach(() => {
      mockUpdateQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setParameters: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({
          raw: [{ failed_login_attempts: 1, locked_until: null }]
        })
      };
      mockRepository.createQueryBuilder.mockReturnValue(mockUpdateQb);
    });

    it('should atomically increment and return new count', async () => {
      const result = await service.incrementFailedAttemptsAndLockIfNeeded(
        'user-1',
        5,
        900000
      );

      expect(mockRepository.createQueryBuilder).toHaveBeenCalled();
      expect(mockUpdateQb.where).toHaveBeenCalledWith('id = :userId', {
        userId: 'user-1'
      });
      expect(mockUpdateQb.setParameters).toHaveBeenCalledWith({
        lockInterval: '900000 milliseconds'
      });
      expect(result).toEqual({
        failedLoginAttempts: 1,
        lockedUntil: null
      });
    });

    it('should pass entity property names (camelCase) to returning()', async () => {
      await service.incrementFailedAttemptsAndLockIfNeeded('user-1', 5, 900000);

      // TypeORM resolves property paths to DB column names internally.
      // Passing quoted SQL names ('"failed_login_attempts"') causes
      // findColumnsWithPropertyPath to find nothing → RETURNING clause is
      // silently dropped → raw = [] → TypeError at runtime.
      expect(mockUpdateQb.returning).toHaveBeenCalledWith([
        'failedLoginAttempts',
        'lockedUntil'
      ]);
    });

    it('should return lockedUntil as Date when threshold is reached', async () => {
      const lockedDate = new Date(Date.now() + 900000).toISOString();
      mockUpdateQb.execute.mockResolvedValue({
        raw: [{ failed_login_attempts: 5, locked_until: lockedDate }]
      });

      const result = await service.incrementFailedAttemptsAndLockIfNeeded(
        'user-1',
        5,
        900000
      );

      expect(result.failedLoginAttempts).toBe(5);
      expect(result.lockedUntil).toBeInstanceOf(Date);
    });

    it('should throw a descriptive error when UPDATE returns no rows', async () => {
      mockUpdateQb.execute.mockResolvedValue({ raw: [] });

      await expect(
        service.incrementFailedAttemptsAndLockIfNeeded('missing-id', 5, 900000)
      ).rejects.toThrow(
        'incrementFailedAttemptsAndLockIfNeeded: user missing-id not found or UPDATE returned no rows'
      );
    });
  });

  describe('resetLoginAttempts', () => {
    it('should reset failed attempts and clear lock', async () => {
      await service.resetLoginAttempts('user-1');

      expect(mockRepository.update).toHaveBeenCalledWith('user-1', {
        failedLoginAttempts: 0,
        lockedUntil: null
      });
    });
  });

  describe('setEmailVerificationToken', () => {
    it('should store hashed token and expiry', async () => {
      const expiresAt = new Date('2025-06-01');

      await service.setEmailVerificationToken(
        'user-1',
        'hashed-token',
        expiresAt
      );

      expect(mockRepository.update).toHaveBeenCalledWith('user-1', {
        emailVerificationToken: 'hashed-token',
        emailVerificationExpiresAt: expiresAt
      });
    });
  });

  describe('findByEmailVerificationToken', () => {
    it('should find user by verification token', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findByEmailVerificationToken('hashed-token');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { emailVerificationToken: 'hashed-token' }
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null when token not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result =
        await service.findByEmailVerificationToken('invalid-token');

      expect(result).toBeNull();
    });
  });

  describe('markEmailVerified', () => {
    it('should set isEmailVerified and clear token fields', async () => {
      await service.markEmailVerified('user-1');

      expect(mockRepository.update).toHaveBeenCalledWith('user-1', {
        isEmailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpiresAt: null
      });
    });
  });

  describe('setPasswordResetToken', () => {
    it('should store hashed token and expiry', async () => {
      const expiresAt = new Date('2025-06-01');

      await service.setPasswordResetToken('user-1', 'hashed-token', expiresAt);

      expect(mockRepository.update).toHaveBeenCalledWith('user-1', {
        passwordResetToken: 'hashed-token',
        passwordResetExpiresAt: expiresAt
      });
    });
  });

  describe('findByPasswordResetToken', () => {
    it('should find user by reset token', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findByPasswordResetToken('hashed-token');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { passwordResetToken: 'hashed-token' }
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null when token not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.findByPasswordResetToken('invalid-token');

      expect(result).toBeNull();
    });
  });

  describe('clearPasswordResetToken', () => {
    it('should clear reset token fields', async () => {
      await service.clearPasswordResetToken('user-1');

      expect(mockRepository.update).toHaveBeenCalledWith('user-1', {
        passwordResetToken: null,
        passwordResetExpiresAt: null
      });
    });
  });
});
