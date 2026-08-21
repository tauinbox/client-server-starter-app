import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { BCRYPT_SALT_ROUNDS, ErrorKeys } from '@app/shared/constants';
import { UsersService } from './users.service';
import { User } from '../entities/user.entity';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { SYSTEM_ABILITY } from '../../auth/casl/app-ability';
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
  let mockMailService: { sendEmailVerification: jest.Mock };
  let mockAuditService: { logFireAndForget: jest.Mock };
  let mockQueryBuilder: {
    leftJoinAndSelect: jest.Mock;
    innerJoin: jest.Mock;
    withDeleted: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
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
    locale: 'en',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    deletedAt: null
  } as User;

  beforeEach(async () => {
    mockQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
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
    mockMailService = {
      sendEmailVerification: jest.fn().mockResolvedValue(undefined)
    };
    mockAuditService = { logFireAndForget: jest.fn() };

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
        },
        {
          provide: AuditService,
          useValue: mockAuditService
        },
        {
          provide: MetricsService,
          useValue: { recordPermissionDenied: jest.fn() }
        },
        {
          provide: MailService,
          useValue: mockMailService
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
        where: [
          { email: 'new@example.com' },
          { pendingEmail: 'new@example.com' }
        ]
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

    it('translates a unique violation on save into the same 409', async () => {
      // The check passes, then a concurrent request claims the address and the
      // unique index rejects this insert.
      mockRepository.findOne.mockResolvedValue(null);
      mockRepository.create.mockReturnValue(mockUser);
      mockRepository.save.mockRejectedValue({ code: '23505' });
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);

      try {
        await service.create(createUserDto);
        fail('Expected HttpException');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
        expect((err as HttpException).getResponse()).toEqual({
          message: 'User with this email already exists',
          errorKey: ErrorKeys.USERS.EMAIL_EXISTS
        });
      }
    });

    it('propagates unrelated database failures from save', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      mockRepository.create.mockReturnValue(mockUser);
      mockRepository.save.mockRejectedValue(new Error('connection lost'));
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);

      await expect(service.create(createUserDto)).rejects.toThrow(
        'connection lost'
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

  describe('findCursorPaginated', () => {
    it('should return cursor-paginated results with default params', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([mockUser]);

      const result = await service.findCursorPaginated(
        {
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc'
        },
        SYSTEM_ABILITY
      );

      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('user');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'user.createdAt',
        'DESC'
      );
      expect(mockQueryBuilder.addOrderBy).toHaveBeenCalledWith(
        'user.id',
        'DESC'
      );
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(21);
      expect(result.data).toEqual([mockUser]);
      expect(result.meta.hasMore).toBe(false);
      expect(result.meta.nextCursor).toBeNull();
      expect(result.meta.limit).toBe(20);
    });

    it('should return nextCursor when there are more results', async () => {
      const users = Array.from({ length: 3 }, (_, i) => ({
        ...mockUser,
        id: `user-${i}`,
        createdAt: new Date(`2025-01-0${i + 1}`)
      }));
      mockQueryBuilder.getMany.mockResolvedValue(users);

      const result = await service.findCursorPaginated(
        {
          limit: 2,
          sortBy: 'createdAt',
          sortOrder: 'desc'
        },
        SYSTEM_ABILITY
      );

      expect(result.data).toHaveLength(2);
      expect(result.meta.hasMore).toBe(true);
      expect(result.meta.nextCursor).not.toBeNull();
    });

    it('should apply filters', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      await service.findCursorPaginated(
        {
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          email: 'test'
        },
        SYSTEM_ABILITY
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.email ILIKE :email',
        { email: '%test%' }
      );
    });

    it('applies unified q filter as OR across email/firstName/lastName/id', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      await service.findCursorPaginated(
        {
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          q: 'al_ice'
        },
        SYSTEM_ABILITY
      );

      type BracketsLike = { whereFactory: (qb: SubRecorder) => void };
      type SubRecorder = {
        where: jest.Mock;
        orWhere: jest.Mock;
      };

      const andWhereCalls = mockQueryBuilder.andWhere.mock.calls as unknown[][];
      const bracketsCall = andWhereCalls.find((call) => {
        const first = call[0];
        return (
          typeof first === 'object' &&
          first !== null &&
          'whereFactory' in (first as Record<string, unknown>)
        );
      });
      expect(bracketsCall).toBeDefined();
      const brackets = bracketsCall?.[0] as BracketsLike;

      const subCalls: { sql: string; params: unknown }[] = [];
      const sub: SubRecorder = {
        where: jest.fn((sql: string, params: unknown) => {
          subCalls.push({ sql, params });
          return sub;
        }),
        orWhere: jest.fn((sql: string, params: unknown) => {
          subCalls.push({ sql, params });
          return sub;
        })
      };
      brackets.whereFactory(sub);

      // `_` is a LIKE wildcard and MUST be escaped in the bound parameter.
      const expectedPattern = '%al\\_ice%';
      expect(subCalls).toEqual([
        { sql: 'user.email ILIKE :q', params: { q: expectedPattern } },
        { sql: 'user.firstName ILIKE :q', params: { q: expectedPattern } },
        { sql: 'user.lastName ILIKE :q', params: { q: expectedPattern } },
        {
          sql: 'CAST(user.id AS text) ILIKE :q',
          params: { q: expectedPattern }
        }
      ]);
    });

    it('should call withDeleted when includeDeleted is true', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      await service.findCursorPaginated(
        {
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          includeDeleted: true
        },
        SYSTEM_ABILITY
      );

      expect(mockQueryBuilder.withDeleted).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update user fields', async () => {
      const updateDto = { firstName: 'Updated' };
      mockRepository.findOne.mockResolvedValue(mockUser);
      mockRepository.save.mockResolvedValue({ ...mockUser, ...updateDto });

      const result = await service.update('user-1', updateDto, SYSTEM_ABILITY);

      expect(mockRepository.merge).toHaveBeenCalledWith(mockUser, updateDto);
      expect(mockRepository.save).toHaveBeenCalledWith(mockUser);
      expect(result.firstName).toBe('Updated');
    });

    it('should hash password when updating password', async () => {
      const updateDto = { password: 'NewPassword1' };
      mockRepository.findOne.mockResolvedValue(mockUser);
      mockRepository.save.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('new-hashed' as never);

      await service.update('user-1', updateDto, SYSTEM_ABILITY);

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
        service.update('nonexistent', { firstName: 'Updated' }, SYSTEM_ABILITY)
      ).rejects.toThrow(HttpException);
    });

    it('should unlock account when unlockAccount is true', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockUser,
        failedLoginAttempts: 5,
        lockedUntil: new Date()
      });
      mockRepository.save.mockResolvedValue(mockUser);

      await service.update('user-1', { unlockAccount: true }, SYSTEM_ABILITY);

      expect(mockRepository.merge).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          failedLoginAttempts: 0,
          lockedUntil: null
        })
      );
    });

    it('should revoke tokens when deactivating a user', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      mockRepository.save.mockResolvedValue({ ...mockUser, isActive: false });

      await service.update('user-1', { isActive: false }, SYSTEM_ABILITY);

      expect(mockRepository.merge).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          isActive: false,
          tokenRevokedAt: expect.any(Date) as Date
        })
      );
    });

    it('translates a unique violation on save into the same 409', async () => {
      mockRepository.findOne
        .mockResolvedValueOnce(mockUser) // target user
        .mockResolvedValueOnce(null); // address free at check time
      mockRepository.save.mockRejectedValue({ code: '23505' });

      try {
        await service.update(
          'user-1',
          { email: 'taken@example.com' },
          SYSTEM_ABILITY
        );
        fail('Expected HttpException');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
        expect((err as HttpException).getResponse()).toEqual({
          message: 'User with this email already exists',
          errorKey: ErrorKeys.USERS.EMAIL_EXISTS,
          field: 'email'
        });
      }
    });

    it('propagates unrelated database failures from save', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      mockRepository.save.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.update('user-1', { firstName: 'Updated' }, SYSTEM_ABILITY)
      ).rejects.toThrow('connection lost');
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

    it('records the denying actor on the update denial audit row', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: jest.fn().mockReturnValue(false) };

      await expect(
        service.update('user-1', { firstName: 'Updated' }, ability, 'actor-1')
      ).rejects.toThrow(ForbiddenException);

      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PERMISSION_CHECK_FAILURE',
          actorId: 'actor-1',
          targetId: 'user-1',
          targetType: 'User'
        })
      );
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

      const result = await service.update(
        'user-1',
        { firstName: 'Updated' },
        SYSTEM_ABILITY
      );

      expect(result.firstName).toBe('Updated');
    });

    describe('email change', () => {
      const buildVerifiedUser = (): User =>
        ({
          ...mockUser,
          isEmailVerified: true,
          emailVerificationToken: null,
          emailVerificationExpiresAt: null
        }) as User;

      beforeEach(() => {
        mockRepository.merge.mockImplementation(
          (target: User, changes: Partial<User>) =>
            Object.assign(target, changes)
        );
        mockRepository.save.mockImplementation((u: User) => Promise.resolve(u));
      });

      it('resets isEmailVerified, issues a verification token and sends a verification email when email changes', async () => {
        const user = buildVerifiedUser();
        // First findOne -> findOne(id) inside update; second findOne -> uniqueness check
        mockRepository.findOne
          .mockResolvedValueOnce(user)
          .mockResolvedValueOnce(null);

        const result = await service.update(
          'user-1',
          {
            email: 'changed@example.com'
          },
          SYSTEM_ABILITY
        );

        expect(result.email).toBe('changed@example.com');
        expect(result.isEmailVerified).toBe(false);
        expect(result.emailVerificationToken).toEqual(expect.any(String));
        expect(result.emailVerificationToken).not.toBeNull();
        expect(result.emailVerificationExpiresAt).toBeInstanceOf(Date);
        expect(mockMailService.sendEmailVerification).toHaveBeenCalledTimes(1);
        expect(mockMailService.sendEmailVerification).toHaveBeenCalledWith(
          'changed@example.com',
          expect.any(String),
          'en'
        );
      });

      it('does not reset verification when email field is unchanged', async () => {
        const user = buildVerifiedUser();
        mockRepository.findOne.mockResolvedValueOnce(user);

        const result = await service.update(
          'user-1',
          { email: user.email },
          SYSTEM_ABILITY
        );

        expect(result.isEmailVerified).toBe(true);
        expect(mockMailService.sendEmailVerification).not.toHaveBeenCalled();
      });

      it('throws 409 with EMAIL_EXISTS errorKey when target email is taken by another user', async () => {
        const user = buildVerifiedUser();
        mockRepository.findOne
          .mockResolvedValueOnce(user)
          .mockResolvedValueOnce({ ...user, id: 'other-user' } as User);

        await expect(
          service.update(
            'user-1',
            { email: 'taken@example.com' },
            SYSTEM_ABILITY
          )
        ).rejects.toMatchObject({
          status: HttpStatus.CONFLICT,
          response: {
            errorKey: ErrorKeys.USERS.EMAIL_EXISTS,
            field: 'email'
          }
        });
        expect(mockMailService.sendEmailVerification).not.toHaveBeenCalled();
      });

      it('allows changing to an email already owned by the same user (no conflict)', async () => {
        const user = buildVerifiedUser();
        mockRepository.findOne
          .mockResolvedValueOnce(user)
          .mockResolvedValueOnce(user);

        // Same id returned by uniqueness check should be ignored
        await expect(
          service.update(
            'user-1',
            { email: 'taken@example.com' },
            SYSTEM_ABILITY
          )
        ).resolves.toBeDefined();
      });
    });
  });

  describe('remove', () => {
    interface RemoveManagerMock {
      update: jest.Mock;
      softRemove: jest.Mock;
    }

    function mockRemoveTransaction(
      overrides: Partial<RemoveManagerMock> = {}
    ): RemoveManagerMock {
      const manager: RemoveManagerMock = {
        update: jest.fn().mockResolvedValue(undefined),
        softRemove: jest.fn().mockResolvedValue(undefined),
        ...overrides
      };
      mockDataSource.transaction.mockImplementation(
        (cb: (m: RemoveManagerMock) => Promise<void>) => cb(manager)
      );
      return manager;
    }

    it('should soft-delete an existing user', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      const manager = mockRemoveTransaction();

      await service.remove('user-1', SYSTEM_ABILITY);

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        relations: ['roles']
      });
      expect(manager.softRemove).toHaveBeenCalledWith(mockUser);
    });

    it('should clear pending email fields and soft-delete in one transaction', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      const manager = mockRemoveTransaction();

      await service.remove('user-1', SYSTEM_ABILITY);

      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(manager.update).toHaveBeenCalledWith(User, 'user-1', {
        pendingEmail: null,
        pendingEmailToken: null,
        pendingEmailExpiresAt: null
      });
      // The pending-field clear must not run outside the transaction.
      expect(mockRepository.update).not.toHaveBeenCalled();
      expect(mockRepository.softRemove).not.toHaveBeenCalled();
    });

    it('should roll back the pending-field clear when soft-delete fails', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      const manager = mockRemoveTransaction({
        softRemove: jest.fn().mockRejectedValue(new Error('db down'))
      });

      await expect(service.remove('user-1', SYSTEM_ABILITY)).rejects.toThrow(
        'db down'
      );

      // The clear was issued on the transactional manager, so the rejection
      // propagating out of the callback rolls it back with the soft-delete.
      expect(manager.update).toHaveBeenCalled();
      expect(mockRepository.update).not.toHaveBeenCalled();
    });

    it('should throw HttpException when user not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.remove('nonexistent', SYSTEM_ABILITY)
      ).rejects.toThrow(HttpException);
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

    it('records the denying actor on the delete denial audit row', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: jest.fn().mockReturnValue(false) };

      await expect(
        service.remove('user-1', ability, 'actor-1')
      ).rejects.toThrow(ForbiddenException);

      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PERMISSION_CHECK_FAILURE',
          actorId: 'actor-1',
          targetId: 'user-1',
          targetType: 'User'
        })
      );
    });

    it('should proceed when ability allows delete', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);
      const manager = mockRemoveTransaction();
      const canSpy = jest.fn().mockReturnValue(true);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: canSpy };

      await service.remove('user-1', ability);

      expect(canSpy).toHaveBeenCalledWith('delete', mockUser);
      expect(manager.softRemove).toHaveBeenCalledWith(mockUser);
    });
  });

  describe('restore', () => {
    const deletedUser: User = {
      ...mockUser,
      deletedAt: new Date('2025-06-01'),
      isActive: false
    } as User;

    it('should lift the soft-delete without reactivating a deactivated user', async () => {
      const mockManager = {
        restore: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined)
      };
      mockDataSource.transaction.mockImplementation(
        (cb: (manager: typeof mockManager) => Promise<void>) => cb(mockManager)
      );
      const restoredUser = { ...deletedUser, deletedAt: null } as User;
      mockRepository.findOne
        .mockResolvedValueOnce(deletedUser) // withDeleted lookup
        .mockResolvedValueOnce(restoredUser); // final findOne after restore

      const result = await service.restore('user-1', SYSTEM_ABILITY);

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        relations: ['roles'],
        withDeleted: true
      });
      expect(mockRepository.restore).toHaveBeenCalledWith('user-1');
      // `isActive` is gated by the `update` action, which this endpoint does
      // not require, so restoring must never write it.
      expect(mockRepository.update).not.toHaveBeenCalled();
      expect(mockManager.update).not.toHaveBeenCalled();
      expect(result.isActive).toBe(false);
    });

    it('should keep an active user active after restore', async () => {
      const deletedActiveUser = {
        ...mockUser,
        deletedAt: new Date('2025-06-01')
      } as User;
      mockRepository.findOne
        .mockResolvedValueOnce(deletedActiveUser)
        .mockResolvedValueOnce(mockUser);

      const result = await service.restore('user-1', SYSTEM_ABILITY);

      expect(mockRepository.restore).toHaveBeenCalledWith('user-1');
      expect(result.isActive).toBe(true);
      expect(result.deletedAt).toBeNull();
    });

    it('should throw HttpException when user does not exist', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.restore('nonexistent', SYSTEM_ABILITY)
      ).rejects.toThrow(HttpException);
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

    it('records the denying actor on the restore denial audit row', async () => {
      mockRepository.findOne.mockResolvedValue(deletedUser);
      // @ts-expect-error partial mock — only `can` is needed for instance-level tests
      const ability: AppAbility = { can: jest.fn().mockReturnValue(false) };

      await expect(
        service.restore('user-1', ability, 'actor-1')
      ).rejects.toThrow(ForbiddenException);

      expect(mockAuditService.logFireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PERMISSION_CHECK_FAILURE',
          actorId: 'actor-1',
          targetId: 'user-1',
          targetType: 'User'
        })
      );
    });

    it('should proceed when ability allows restore', async () => {
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
        maxAttempts: 5,
        lockInterval: '900000 milliseconds'
      });
      expect(result).toEqual({
        failedLoginAttempts: 1,
        lockedUntil: null
      });
    });

    it('should bind the lockout threshold instead of inlining it', async () => {
      await service.incrementFailedAttemptsAndLockIfNeeded('user-1', 7, 900000);

      const updateSet = (
        mockUpdateQb.set.mock.calls[0] as [{ lockedUntil: () => string }]
      )[0];
      const lockedUntilSql = updateSet.lockedUntil();

      expect(lockedUntilSql).toContain(':maxAttempts::int');
      expect(lockedUntilSql).not.toContain('7');
      expect(mockUpdateQb.setParameters).toHaveBeenCalledWith(
        expect.objectContaining({ maxAttempts: 7 })
      );
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

  // The authorization argument is required on every method that filters or
  // instance-checks, so a caller cannot get unfiltered data by omitting it.
  // ts-jest typechecks this file, so an accidental revert to an optional
  // parameter makes each @ts-expect-error unused and fails the suite.
  describe('authorization argument is mandatory', () => {
    const query = {
      limit: 10,
      sortBy: 'createdAt',
      sortOrder: 'desc'
    } as const;

    it('does not compile when omitted', () => {
      // @ts-expect-error ability is required
      void (() => service.findCursorPaginated({ ...query, cursor: undefined }));
      // @ts-expect-error ability is required
      void (() => service.update('user-1', { firstName: 'x' }));
      // @ts-expect-error ability is required
      void (() => service.remove('user-1'));
      // @ts-expect-error ability is required
      void (() => service.restore('user-1'));
    });

    it('rejects undefined in place of an ability', () => {
      // @ts-expect-error undefined is not an ability nor the system sentinel
      void (() => service.remove('user-1', undefined));
    });
  });
});
