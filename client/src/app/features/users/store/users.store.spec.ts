import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { storeOverrideWarnings } from '../../../../test-utils/store-override-warnings';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';

import { UsersStore } from './users.store';
import { UserService } from '../services/user.service';
import { NotifyService } from '@core/services/notify.service';
import type { CursorPaginatedResponse, User } from '../models/user.types';
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
  name: 'Test User',
  roles: [mockUserRole],
  isActive: true,
  isEmailVerified: true,
  hasPassword: true,
  mfaEnabled: false,
  locale: 'en',
  lockedUntil: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  deletedAt: null
};

const page = (users: User[]): CursorPaginatedResponse<User> => ({
  data: users,
  meta: { nextCursor: null, hasMore: false, limit: 20 }
});

/** Lets the in-flight page settle; the cursor feature resolves on a promise. */
async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('UsersStore', () => {
  let userServiceMock: {
    getAllCursor: ReturnType<typeof vi.fn>;
    searchCursor: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    getListRow: ReturnType<typeof vi.fn>;
  };
  let store: InstanceType<typeof UsersStore>;

  beforeEach(() => {
    userServiceMock = {
      getAllCursor: vi.fn().mockReturnValue(of(page([mockUser]))),
      searchCursor: vi.fn().mockReturnValue(of(page([mockUser]))),
      getById: vi.fn().mockReturnValue(of(mockUser)),
      update: vi.fn().mockReturnValue(of(mockUser)),
      delete: vi.fn().mockReturnValue(of(void 0)),
      restore: vi.fn().mockReturnValue(of(mockUser)),
      getListRow: vi.fn()
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
    it('routes the request through search so the flag reaches the API', async () => {
      store.setFilters({ includeDeleted: true });
      store.load();
      await settled();

      expect(userServiceMock.searchCursor).toHaveBeenCalledWith(
        expect.objectContaining({ includeDeleted: true }),
        expect.anything()
      );
      expect(userServiceMock.getAllCursor).not.toHaveBeenCalled();
    });

    it('uses the plain list endpoint when no filter is set', async () => {
      store.load();
      await settled();

      expect(userServiceMock.getAllCursor).toHaveBeenCalled();
      expect(userServiceMock.searchCursor).not.toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('drops the row from the list by default', async () => {
      store.load();
      await settled();
      store.deleteUser('user-1').subscribe();

      expect(store.entities()).toEqual([]);
      expect(store.entities()).toHaveLength(0);
    });

    it('keeps the row and marks it deleted while deleted users are shown', async () => {
      store.setFilters({ includeDeleted: true });
      store.load();
      await settled();
      store.deleteUser('user-1').subscribe();

      const [entity] = store.entities();
      expect(entity.id).toBe('user-1');
      expect(entity.deletedAt).not.toBeNull();
      expect(store.entities()).toHaveLength(1);
    });
  });

  describe('restoreUser', () => {
    it('replaces the row with the restored user returned by the API', async () => {
      const deleted: User = { ...mockUser, deletedAt: '2024-02-01T00:00:00Z' };
      userServiceMock.getAllCursor.mockReturnValue(of(page([deleted])));
      store.load();
      await settled();

      store.restoreUser('user-1').subscribe();

      expect(userServiceMock.restore).toHaveBeenCalledWith('user-1');
      expect(store.entities()[0].deletedAt).toBeNull();
    });

    it('preserves the deactivated state the server returns', async () => {
      const deactivated: User = { ...mockUser, isActive: false };
      userServiceMock.restore.mockReturnValue(of(deactivated));
      store.load();
      await settled();

      store.restoreUser('user-1').subscribe();

      expect(store.entities()[0].isActive).toBe(false);
    });
  });

  describe('loadOne', () => {
    it.each([403, 404, 500, 0])(
      'keeps the status %i of a failed load and leaves the message to the page',
      (status) => {
        userServiceMock.getById.mockReturnValue(
          throwError(() => new HttpErrorResponse({ status }))
        );

        store.loadOne('user-1');

        expect(store.detailError()).toBe(status);
        expect(store.detailLoading()).toBe(false);
        expect(TestBed.inject(NotifyService).error).not.toHaveBeenCalled();
      }
    );

    it('clears the status when the next load succeeds', () => {
      userServiceMock.getById.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 500 }))
      );
      store.loadOne('user-1');

      store.loadOne('user-1');

      expect(store.detailError()).toBeNull();
      expect(store.entityMap()['user-1']).toEqual(mockUser);
    });
  });

  describe('applyUserEvent', () => {
    const alice: User = { ...mockUser, id: 'alice', name: 'Alice' };
    const bob: User = { ...mockUser, id: 'bob', name: 'Bob' };
    const event = (
      action: 'created' | 'updated' | 'deleted' | 'restored',
      userId: string
    ) => ({ type: 'user_crud_events' as const, action, userId });

    beforeEach(async () => {
      userServiceMock.getAllCursor
        .mockReturnValueOnce(
          of({
            data: [alice],
            meta: { nextCursor: 'c1', hasMore: true, limit: 1 }
          })
        )
        .mockReturnValueOnce(
          of({
            data: [bob],
            meta: { nextCursor: 'c2', hasMore: true, limit: 1 }
          })
        );
      store.load();
      await settled();
      store.loadMore();
      await settled();
    });

    it('updates a loaded row in place and keeps the other pages and the cursor', () => {
      userServiceMock.getListRow.mockReturnValue(
        of({ ...bob, name: 'Robert' })
      );

      store.applyUserEvent(event('updated', 'bob'));

      expect(userServiceMock.getListRow).toHaveBeenCalledWith('bob');
      expect(store.entities().map((user) => user.name)).toEqual([
        'Alice',
        'Robert'
      ]);
      expect(store.nextCursor()).toBe('c2');
      expect(userServiceMock.getAllCursor).toHaveBeenCalledTimes(2);
      expect(store.stale()).toBe(false);
    });

    it('sends no request for a row that is not loaded', () => {
      store.applyUserEvent(event('updated', 'carol'));
      store.applyUserEvent(event('restored', 'carol'));
      store.applyUserEvent(event('deleted', 'carol'));

      expect(userServiceMock.getListRow).not.toHaveBeenCalled();
      expect(store.entities()).toHaveLength(2);
      expect(store.stale()).toBe(false);
    });

    it('removes a deleted row with no request', () => {
      store.applyUserEvent(event('deleted', 'alice'));

      expect(userServiceMock.getListRow).not.toHaveBeenCalled();
      expect(store.entities().map((user) => user.id)).toEqual(['bob']);
      expect(store.stale()).toBe(false);
    });

    it('marks the list stale for a delete while deleted users are shown', () => {
      store.setFilters({ includeDeleted: true });
      store.applyUserEvent(event('deleted', 'alice'));

      expect(store.entities()).toHaveLength(2);
      expect(store.stale()).toBe(true);
    });

    it('does not mark the list stale for a delete that the row already shows', () => {
      store.setFilters({ includeDeleted: true });
      store.deleteUser('alice').subscribe();

      store.applyUserEvent(event('deleted', 'alice'));

      expect(store.stale()).toBe(false);
    });

    it('marks the list stale for a created user and sends no request', () => {
      store.applyUserEvent(event('created', 'carol'));

      expect(userServiceMock.getListRow).not.toHaveBeenCalled();
      expect(userServiceMock.getAllCursor).toHaveBeenCalledTimes(2);
      expect(store.stale()).toBe(true);
    });

    it('removes a row that the server no longer finds', () => {
      userServiceMock.getListRow.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 404 }))
      );

      store.applyUserEvent(event('updated', 'alice'));

      expect(store.entities().map((user) => user.id)).toEqual(['bob']);
    });

    it('keeps the row and marks the list stale when the read is refused', () => {
      userServiceMock.getListRow.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 403 }))
      );

      store.applyUserEvent(event('updated', 'alice'));

      expect(store.entities()).toHaveLength(2);
      expect(store.stale()).toBe(true);
    });

    it('applies only the latest event of a user', () => {
      const first = new Subject<User>();
      const second = new Subject<User>();
      userServiceMock.getListRow
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second);

      store.applyUserEvent(event('updated', 'alice'));
      store.applyUserEvent(event('updated', 'alice'));
      second.next({ ...alice, name: 'New' });
      first.next({ ...alice, name: 'Old' });

      expect(store.entityMap()['alice']?.name).toBe('New');
    });

    it('does not bring back a row that a reload dropped while the read ran', async () => {
      const read = new Subject<User>();
      userServiceMock.getListRow.mockReturnValue(read);
      userServiceMock.getAllCursor.mockReturnValueOnce(of(page([bob])));

      store.applyUserEvent(event('updated', 'alice'));
      store.load();
      await settled();
      read.next({ ...alice, name: 'Late' });

      expect(store.entities().map((user) => user.id)).toEqual(['bob']);
    });

    it('clears the stale mark on the next first-page load', async () => {
      userServiceMock.getAllCursor.mockReturnValueOnce(of(page([alice])));
      store.markStale();

      store.load();
      await settled();

      expect(store.stale()).toBe(false);
    });
  });
});

describe('UsersStore members', () => {
  it('declares each store member once', () => {
    TestBed.configureTestingModule({
      providers: [
        UsersStore,
        { provide: UserService, useValue: {} },
        { provide: NotifyService, useValue: {} }
      ]
    });
    expect(storeOverrideWarnings(() => TestBed.inject(UsersStore))).toEqual([]);
  });
});
