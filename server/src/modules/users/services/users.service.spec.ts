import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { User } from '../entities/user.entity';

describe('UsersService', () => {
  let service: UsersService;
  let mockRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    merge: jest.Mock;
    createQueryBuilder: jest.Mock;
    increment: jest.Mock;
    update: jest.Mock;
  };
  let mockQueryBuilder: {
    leftJoinAndSelect: jest.Mock;
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
    isAdmin: false,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01')
  } as User;

  beforeEach(async () => {
    mockQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
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
      remove: jest.fn(),
      merge: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      increment: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined)
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockRepository
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
      expect(bcrypt.hash).toHaveBeenCalledWith('Password1', 10);
      expect(mockRepository.create).toHaveBeenCalledWith({
        ...createUserDto,
        password: 'hashed'
      });
      expect(mockRepository.save).toHaveBeenCalledWith(mockUser);
      expect(result).toEqual(mockUser);
    });

    it('should throw ConflictException when email already exists', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);

      await expect(service.create(createUserDto)).rejects.toThrow(
        ConflictException
      );
      await expect(service.create(createUserDto)).rejects.toThrow(
        'User with this email already exists'
      );
    });
  });

  describe('findAll', () => {
    it('should return all users', async () => {
      const users = [mockUser, { ...mockUser, id: 'user-2' }];
      mockRepository.find.mockResolvedValue(users);

      const result = await service.findAll();

      expect(mockRepository.find).toHaveBeenCalled();
      expect(result).toEqual(users);
    });

    it('should return empty array when no users exist', async () => {
      mockRepository.find.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
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

    it('should throw NotFoundException when user not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException
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

  describe('searchUsers', () => {
    it('should search by email filter', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([mockUser]);

      const result = await service.searchUsers({ email: 'test' });

      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('user');
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.email LIKE :email',
        { email: '%test%' }
      );
      expect(result).toEqual([mockUser]);
    });

    it('should search by firstName filter (ILIKE)', async () => {
      await service.searchUsers({ firstName: 'John' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.firstName ILIKE :firstName',
        { firstName: '%John%' }
      );
    });

    it('should search by lastName filter (ILIKE)', async () => {
      await service.searchUsers({ lastName: 'Doe' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.lastName ILIKE :lastName',
        { lastName: '%Doe%' }
      );
    });

    it('should search by isAdmin filter', async () => {
      await service.searchUsers({ isAdmin: true });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.isAdmin = :isAdmin',
        { isAdmin: true }
      );
    });

    it('should search by isActive filter', async () => {
      await service.searchUsers({ isActive: false });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.isActive = :isActive',
        { isActive: false }
      );
    });

    it('should combine multiple filters', async () => {
      await service.searchUsers({
        email: 'test',
        firstName: 'John',
        isAdmin: true
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(3);
    });

    it('should return all users when no filters provided', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([mockUser]);

      const result = await service.searchUsers({});

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
      expect(result).toEqual([mockUser]);
    });

    it('should escape special LIKE characters in filters', async () => {
      await service.searchUsers({ email: '50%_off\\' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.email LIKE :email',
        { email: '%50\\%\\_off\\\\%' }
      );
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
        email: 'test',
        isAdmin: true
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.email LIKE :email',
        { email: '%test%' }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.isAdmin = :isAdmin',
        { isAdmin: true }
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

      expect(bcrypt.hash).toHaveBeenCalledWith('NewPassword1', 10);
      expect(mockRepository.merge).toHaveBeenCalledWith(mockUser, {
        password: 'new-hashed'
      });
    });

    it('should throw NotFoundException when user not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { firstName: 'Updated' })
      ).rejects.toThrow(NotFoundException);
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
  });

  describe('createOAuthUser', () => {
    it('should create a user without password and with email verified', async () => {
      const oauthData = {
        email: 'oauth@example.com',
        firstName: 'OAuth',
        lastName: 'User'
      };
      const oauthUser = {
        ...mockUser,
        ...oauthData,
        password: null,
        isEmailVerified: true
      };
      mockRepository.create.mockReturnValue(oauthUser);
      mockRepository.save.mockResolvedValue(oauthUser);

      const result = await service.createOAuthUser(oauthData);

      expect(mockRepository.create).toHaveBeenCalledWith({
        email: 'oauth@example.com',
        firstName: 'OAuth',
        lastName: 'User',
        password: null,
        isEmailVerified: true
      });
      expect(mockRepository.save).toHaveBeenCalledWith(oauthUser);
      expect(result.password).toBeNull();
    });
  });

  describe('remove', () => {
    it('should remove an existing user', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      mockRepository.remove.mockResolvedValue(mockUser);

      await service.remove('user-1');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        relations: ['roles']
      });
      expect(mockRepository.remove).toHaveBeenCalledWith(mockUser);
    });

    it('should throw NotFoundException when user not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.remove('nonexistent')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('incrementFailedAttempts', () => {
    it('should increment failed login attempts', async () => {
      await service.incrementFailedAttempts('user-1');

      expect(mockRepository.increment).toHaveBeenCalledWith(
        { id: 'user-1' },
        'failedLoginAttempts',
        1
      );
    });
  });

  describe('lockAccount', () => {
    it('should set lockedUntil for user', async () => {
      const lockedUntil = new Date('2025-06-01');

      await service.lockAccount('user-1', lockedUntil);

      expect(mockRepository.update).toHaveBeenCalledWith('user-1', {
        lockedUntil
      });
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
