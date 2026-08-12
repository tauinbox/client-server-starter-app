import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { firstValueFrom, of, throwError } from 'rxjs';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';

import { ResourcesStore } from './resources.store';
import { RbacAdminService } from '../services/rbac-admin.service';
import { AuthService } from '@features/auth/services/auth.service';
import { NotifyService } from '@core/services/notify.service';
import type { ResourceResponse } from '@app/shared/types/rbac.types';

const mockResource: ResourceResponse = {
  id: 'res-1',
  name: 'user',
  subject: 'User',
  displayName: 'Users',
  description: 'User management',
  isSystem: true,
  isOrphaned: false,
  isRegistered: true,
  allowedActionNames: null,
  createdAt: '2024-01-01T00:00:00.000Z'
};

const mockResource2: ResourceResponse = {
  id: 'res-2',
  name: 'role',
  subject: 'Role',
  displayName: 'Roles',
  description: null,
  isSystem: true,
  isOrphaned: false,
  isRegistered: true,
  allowedActionNames: null,
  createdAt: '2024-01-01T00:00:00.000Z'
};

function cursorPage<T>(data: T[], nextCursor: string | null = null) {
  return {
    data,
    meta: { nextCursor, hasMore: nextCursor !== null, limit: 20 }
  };
}

describe('ResourcesStore', () => {
  let rbacServiceMock: {
    getResourcesCursor: ReturnType<typeof vi.fn>;
    updateResource: ReturnType<typeof vi.fn>;
    restoreResource: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: { fetchRbacMetadata: ReturnType<typeof vi.fn> };
  let notifyMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };

  function createStore() {
    rbacServiceMock = {
      getResourcesCursor: vi
        .fn()
        .mockReturnValue(of(cursorPage([mockResource]))),
      updateResource: vi.fn(),
      restoreResource: vi.fn()
    };

    authServiceMock = {
      fetchRbacMetadata: vi.fn().mockResolvedValue(undefined)
    };

    notifyMock = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    };

    TestBed.configureTestingModule({
      imports: [TranslocoTestingModuleWithLangs],
      providers: [
        ResourcesStore,
        { provide: RbacAdminService, useValue: rbacServiceMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: NotifyService, useValue: notifyMock }
      ]
    });

    return TestBed.inject(ResourcesStore);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  describe('load()', () => {
    it('asks for the first page and fills the collection', async () => {
      const store = createStore();
      store.load();
      await vi.waitFor(() => expect(store.loading()).toBe(false));

      expect(rbacServiceMock.getResourcesCursor).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: null })
      );
      expect(store.resources()).toEqual([mockResource]);
      expect(store.hasMore()).toBe(false);
    });

    it('appends the next page instead of replacing the first', async () => {
      const store = createStore();
      rbacServiceMock.getResourcesCursor.mockReturnValue(
        of(cursorPage([mockResource], 'cur-1'))
      );
      store.load();
      await vi.waitFor(() => expect(store.resources()).toHaveLength(1));

      rbacServiceMock.getResourcesCursor.mockReturnValue(
        of(cursorPage([mockResource2]))
      );
      store.loadMore();
      await vi.waitFor(() => expect(store.resources()).toHaveLength(2));

      expect(rbacServiceMock.getResourcesCursor).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: 'cur-1' })
      );
      expect(store.hasMore()).toBe(false);
    });

    it('shows a snackbar on error', async () => {
      const store = createStore();
      rbacServiceMock.getResourcesCursor.mockReturnValue(
        throwError(() => new Error('boom'))
      );
      store.load();
      await vi.waitFor(() => expect(store.loading()).toBe(false));

      expect(notifyMock.error).toHaveBeenCalledWith(
        expect.anything(),
        'admin.store.errorLoadResourcesFailed'
      );
      expect(store.resources()).toEqual([]);
    });
  });

  describe('updateResource()', () => {
    it('replaces the row and refreshes the RBAC metadata', async () => {
      const store = createStore();
      store.load();
      await vi.waitFor(() => expect(store.resources()).toHaveLength(1));

      const updated = { ...mockResource, displayName: 'People' };
      rbacServiceMock.updateResource.mockReturnValue(of(updated));

      await firstValueFrom(
        store.updateResource('res-1', { displayName: 'People' })
      );

      expect(store.resources()[0].displayName).toBe('People');
      expect(authServiceMock.fetchRbacMetadata).toHaveBeenCalled();
    });
  });

  describe('restoreResource()', () => {
    it('replaces the row and refreshes the RBAC metadata', async () => {
      const store = createStore();
      store.load();
      await vi.waitFor(() => expect(store.resources()).toHaveLength(1));

      const restored = { ...mockResource, isOrphaned: false };
      rbacServiceMock.restoreResource.mockReturnValue(of(restored));

      await firstValueFrom(store.restoreResource('res-1'));

      expect(store.resources()[0].isOrphaned).toBe(false);
      expect(authServiceMock.fetchRbacMetadata).toHaveBeenCalled();
    });
  });
});
