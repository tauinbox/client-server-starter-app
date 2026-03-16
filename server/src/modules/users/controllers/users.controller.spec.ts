import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from '../services/users.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { JwtAuthRequest } from '../../auth/types/auth.request';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { UserDeletedEvent } from '../events/user-deleted.event';
import { CreateUserDto } from '../dtos/create-user.dto';
import { UpdateUserDto } from '../dtos/update-user.dto';
import { SearchUsersQueryDto } from '../dtos/search-users-query.dto';

const allowAllGuard = { canActivate: () => true };

function mockJwtRequest(
  userId = 'user-1',
  email = 'admin@example.com'
): {
  user: JwtAuthRequest['user'];
  ip: string;
  headers: Record<string, string>;
} {
  return {
    user: { userId, email, roles: [] },
    ip: '127.0.0.1',
    headers: {}
  };
}

describe('UsersController', () => {
  let controller: UsersController;
  let usersServiceMock: {
    create: jest.Mock;
    findPaginated: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    restore: jest.Mock;
  };
  let eventEmitterMock: { emit: jest.Mock };
  let auditServiceMock: { log: jest.Mock };

  beforeEach(async () => {
    usersServiceMock = {
      create: jest.fn(),
      findPaginated: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      restore: jest.fn()
    };

    eventEmitterMock = { emit: jest.fn() };

    auditServiceMock = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersServiceMock },
        { provide: EventEmitter2, useValue: eventEmitterMock },
        { provide: AuditService, useValue: auditServiceMock }
      ]
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowAllGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(allowAllGuard)
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── create ────────────────────────────────────────────────────────

  describe('create', () => {
    it('should call usersService.create with the dto and return the created user', async () => {
      const dto: CreateUserDto = {
        email: 'new@example.com',
        firstName: 'New',
        lastName: 'User',
        password: 'Password1'
      };
      const createdUser = { id: 'user-99', email: 'new@example.com' };
      usersServiceMock.create.mockResolvedValue(createdUser);
      const req = mockJwtRequest() as JwtAuthRequest;

      const result = await controller.create(dto, req);

      expect(usersServiceMock.create).toHaveBeenCalledWith(dto);
      expect(result).toBe(createdUser);
    });

    it('should log USER_CREATE with targetId equal to the created user id', async () => {
      const dto: CreateUserDto = {
        email: 'new@example.com',
        firstName: 'New',
        lastName: 'User',
        password: 'Password1'
      };
      const createdUser = { id: 'user-99', email: 'new@example.com' };
      usersServiceMock.create.mockResolvedValue(createdUser);
      const req = mockJwtRequest(
        'actor-1',
        'admin@example.com'
      ) as JwtAuthRequest;

      await controller.create(dto, req);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_CREATE,
          actorId: 'actor-1',
          actorEmail: 'admin@example.com',
          targetId: 'user-99',
          targetType: 'User'
        })
      );
    });
  });

  // ── findAll ───────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should call usersService.findPaginated with the query and return the result', () => {
      const query = new SearchUsersQueryDto();
      const paginatedResult = { data: [], total: 0, page: 1, limit: 10 };
      usersServiceMock.findPaginated.mockReturnValue(paginatedResult);

      const result = controller.findAll(query);

      expect(usersServiceMock.findPaginated).toHaveBeenCalledWith(query);
      expect(result).toBe(paginatedResult);
    });
  });

  // ── searchUsers ───────────────────────────────────────────────────

  describe('searchUsers', () => {
    it('should call usersService.findPaginated with the query and return the result', () => {
      const query = new SearchUsersQueryDto();
      query.email = 'partial@example.com';
      const paginatedResult = {
        data: [{ id: 'u1' }],
        total: 1,
        page: 1,
        limit: 10
      };
      usersServiceMock.findPaginated.mockReturnValue(paginatedResult);

      const result = controller.searchUsers(query);

      expect(usersServiceMock.findPaginated).toHaveBeenCalledWith(query);
      expect(result).toBe(paginatedResult);
    });
  });

  // ── findOne ───────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should delegate to usersService.findOne with the correct id', async () => {
      const user = { id: 'user-5', email: 'user5@example.com' };
      usersServiceMock.findOne.mockResolvedValue(user);

      const result = await controller.findOne('user-5');

      expect(usersServiceMock.findOne).toHaveBeenCalledWith('user-5');
      expect(result).toBe(user);
    });
  });

  // ── update ────────────────────────────────────────────────────────

  describe('update', () => {
    it('should call usersService.update with id and dto, and return the updated user', async () => {
      const dto: UpdateUserDto = { firstName: 'Updated', isActive: false };
      const updatedUser = { id: 'user-5', firstName: 'Updated' };
      usersServiceMock.update.mockResolvedValue(updatedUser);
      const req = mockJwtRequest() as JwtAuthRequest;

      const result = await controller.update('user-5', dto, req);

      expect(usersServiceMock.update).toHaveBeenCalledWith('user-5', dto);
      expect(result).toBe(updatedUser);
    });

    it('should log USER_UPDATE with changedFields excluding password', async () => {
      const dto: UpdateUserDto = {
        firstName: 'Updated',
        lastName: 'Name',
        isActive: true
      };
      usersServiceMock.update.mockResolvedValue({ id: 'user-5' });
      const req = mockJwtRequest(
        'actor-2',
        'admin@example.com'
      ) as JwtAuthRequest;

      await controller.update('user-5', dto, req);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_UPDATE,
          actorId: 'actor-2',
          actorEmail: 'admin@example.com',
          targetId: 'user-5',
          targetType: 'User',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          details: expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            changedFields: expect.arrayContaining([
              'firstName',
              'lastName',
              'isActive'
            ])
          })
        })
      );
    });

    it('should NOT log PASSWORD_CHANGE when dto does not contain password', async () => {
      const dto: UpdateUserDto = { firstName: 'Updated' };
      usersServiceMock.update.mockResolvedValue({ id: 'user-5' });
      const req = mockJwtRequest() as JwtAuthRequest;

      await controller.update('user-5', dto, req);

      expect(auditServiceMock.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.PASSWORD_CHANGE })
      );
    });

    it('should log USER_UPDATE and PASSWORD_CHANGE when dto contains password', async () => {
      const dto: UpdateUserDto = { firstName: 'Updated', password: 'NewPass1' };
      usersServiceMock.update.mockResolvedValue({ id: 'user-5' });
      const req = mockJwtRequest(
        'actor-3',
        'admin@example.com'
      ) as JwtAuthRequest;

      await controller.update('user-5', dto, req);

      expect(auditServiceMock.log).toHaveBeenCalledTimes(2);
      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.USER_UPDATE })
      );
      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PASSWORD_CHANGE,
          actorId: 'actor-3',
          actorEmail: 'admin@example.com',
          targetId: 'user-5',
          targetType: 'User',
          details: { source: 'admin' }
        })
      );
    });

    it('should not include password in changedFields when dto contains password', async () => {
      const dto: UpdateUserDto = { firstName: 'Updated', password: 'NewPass1' };
      usersServiceMock.update.mockResolvedValue({ id: 'user-5' });
      const req = mockJwtRequest() as JwtAuthRequest;

      await controller.update('user-5', dto, req);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_UPDATE,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          details: expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            changedFields: expect.not.arrayContaining(['password'])
          })
        })
      );
      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_UPDATE,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          details: expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            changedFields: expect.arrayContaining(['firstName'])
          })
        })
      );
    });
  });

  // ── remove ────────────────────────────────────────────────────────

  describe('remove', () => {
    it('should call usersService.findOne and usersService.remove with the id', async () => {
      const user = { id: 'user-7', email: 'del@example.com' };
      usersServiceMock.findOne.mockResolvedValue(user);
      usersServiceMock.remove.mockResolvedValue(undefined);
      const req = mockJwtRequest() as JwtAuthRequest;

      await controller.remove('user-7', req);

      expect(usersServiceMock.findOne).toHaveBeenCalledWith('user-7');
      expect(usersServiceMock.remove).toHaveBeenCalledWith('user-7');
    });

    it('should emit UserDeletedEvent with the correct user id', async () => {
      const user = { id: 'user-7', email: 'del@example.com' };
      usersServiceMock.findOne.mockResolvedValue(user);
      usersServiceMock.remove.mockResolvedValue(undefined);
      const req = mockJwtRequest() as JwtAuthRequest;

      await controller.remove('user-7', req);

      expect(eventEmitterMock.emit).toHaveBeenCalledWith(
        UserDeletedEvent.name,
        expect.any(UserDeletedEvent)
      );
      const [[, emittedEvent]] = eventEmitterMock.emit.mock.calls as [
        [string, UserDeletedEvent]
      ];
      expect(emittedEvent.userId).toBe('user-7');
    });

    it('should log USER_DELETE with targetEmail from the found user', async () => {
      const user = { id: 'user-7', email: 'del@example.com' };
      usersServiceMock.findOne.mockResolvedValue(user);
      usersServiceMock.remove.mockResolvedValue(undefined);
      const req = mockJwtRequest(
        'actor-4',
        'admin@example.com'
      ) as JwtAuthRequest;

      await controller.remove('user-7', req);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_DELETE,
          actorId: 'actor-4',
          actorEmail: 'admin@example.com',
          targetId: 'user-7',
          targetType: 'User',
          details: { targetEmail: 'del@example.com' }
        })
      );
    });

    it('should return an empty object', async () => {
      usersServiceMock.findOne.mockResolvedValue({
        id: 'user-7',
        email: 'del@example.com'
      });
      usersServiceMock.remove.mockResolvedValue(undefined);
      const req = mockJwtRequest() as JwtAuthRequest;

      const result = await controller.remove('user-7', req);

      expect(result).toEqual({});
    });
  });

  // ── restore ───────────────────────────────────────────────────────

  describe('restore', () => {
    it('should call usersService.restore with the id and return the restored user', async () => {
      const restoredUser = { id: 'user-8', email: 'restored@example.com' };
      usersServiceMock.restore.mockResolvedValue(restoredUser);
      const req = mockJwtRequest() as JwtAuthRequest;

      const result = await controller.restore('user-8', req);

      expect(usersServiceMock.restore).toHaveBeenCalledWith('user-8');
      expect(result).toBe(restoredUser);
    });

    it('should log USER_RESTORE with targetEmail from the restored user', async () => {
      const restoredUser = { id: 'user-8', email: 'restored@example.com' };
      usersServiceMock.restore.mockResolvedValue(restoredUser);
      const req = mockJwtRequest(
        'actor-5',
        'admin@example.com'
      ) as JwtAuthRequest;

      await controller.restore('user-8', req);

      expect(auditServiceMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.USER_RESTORE,
          actorId: 'actor-5',
          actorEmail: 'admin@example.com',
          targetId: 'user-8',
          targetType: 'User',
          details: { targetEmail: 'restored@example.com' }
        })
      );
    });
  });
});
