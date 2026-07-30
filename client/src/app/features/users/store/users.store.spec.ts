import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';

import { UsersStore } from './users.store';
import { UserService } from '../services/user.service';
import { NotifyService } from '@core/services/notify.service';
import type { PaginatedResponse, User } from '../models/user.types';
import type { RoleAdminResponse } from '@app/shared/types';

const mockUserRole: RoleAdminResponse = {
  id: 'role-user',
  name: 'user',
  description: 'Regular user',
  isSystem: true,
  isSuper: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  roles: [mockUserRole],
  isActive: true,
  isEmailVerified: true,
  locale: 'en',
  lockedUntil: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  deletedAt: null
};

const page = (users: User[]): PaginatedResponse<User> => ({
  data: users,
  meta: { total: users.length, page: 1, limit: 20, totalPages: 1 }
});

describe('UsersStore', () => {
  let userServiceMock: {
    getAll: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
  };
  let store: InstanceType<typeof UsersStore>;

  beforeEach(() => {
    userServiceMock = {
      getAll: vi.fn().mockReturnValue(of(page([mockUser]))),
      search: vi.fn().mockReturnValue(of(page([mockUser]))),
      getById: vi.fn().mockReturnValue(of(mockUser)),
      update: vi.fn().mockReturnValue(of(mockUser)),
      delete: vi.fn().mockReturnValue(of(void 0)),
      restore: vi.fn().mockReturnValue(of(mockUser))
    };

    TestBed.configureTestingModule({
      imports: [TranslocoTestingModuleWithLangs],
      providers: [
        UsersStore,
        { provide: UserService, useValue: userServiceMock },
        {
          provide: NotifyService,
          useValue: { success: vi.fn(), error: vi.fn() }
        }
      ]
    });

    store = TestBed.inject(UsersStore);
  });

  describe('includeDeleted', () => {
    it('routes the request through search so the flag reaches the API', () => {
      store.setFilters({ includeDeleted: true });
      store.load();

      expect(userServiceMock.search).toHaveBeenCalledWith(
        expect.objectContaining({ includeDeleted: true }),
        expect.anything()
      );
      expect(userServiceMock.getAll).not.toHaveBeenCalled();
    });

    it('uses the plain list endpoint when no filter is set', () => {
      store.load();

      expect(userServiceMock.getAll).toHaveBeenCalled();
      expect(userServiceMock.search).not.toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('drops the row from the list by default', () => {
      store.load();
      store.deleteUser('user-1').subscribe();

      expect(store.entities()).toEqual([]);
      expect(store.totalUsers()).toBe(0);
    });

    it('keeps the row and marks it deleted while deleted users are shown', () => {
      store.setFilters({ includeDeleted: true });
      store.load();
      store.deleteUser('user-1').subscribe();

      const [entity] = store.entities();
      expect(entity.id).toBe('user-1');
      expect(entity.deletedAt).not.toBeNull();
      expect(store.totalUsers()).toBe(1);
    });
  });

  describe('restoreUser', () => {
    it('replaces the row with the restored user returned by the API', () => {
      const deleted: User = { ...mockUser, deletedAt: '2024-02-01T00:00:00Z' };
      userServiceMock.getAll.mockReturnValue(of(page([deleted])));
      store.load();

      store.restoreUser('user-1').subscribe();

      expect(userServiceMock.restore).toHaveBeenCalledWith('user-1');
      expect(store.entities()[0].deletedAt).toBeNull();
    });

    it('preserves the deactivated state the server returns', () => {
      const deactivated: User = { ...mockUser, isActive: false };
      userServiceMock.restore.mockReturnValue(of(deactivated));
      store.load();

      store.restoreUser('user-1').subscribe();

      expect(store.entities()[0].isActive).toBe(false);
    });
  });
});
