import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { firstValueFrom, of, throwError } from 'rxjs';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';

import { ActionsStore } from './actions.store';
import { RbacAdminService } from '../services/rbac-admin.service';
import { AuthService } from '@features/auth/services/auth.service';
import { NotifyService } from '@core/services/notify.service';
import type { ActionResponse } from '@app/shared/types/rbac.types';

const mockAction: ActionResponse = {
  id: 'act-1',
  name: 'read',
  displayName: 'Read',
  description: 'Read access',
  isDefault: true,
  createdAt: '2024-01-01T00:00:00.000Z'
};

const mockAction2: ActionResponse = {
  id: 'act-2',
  name: 'write',
  displayName: 'Write',
  description: 'Write access',
  isDefault: false,
  createdAt: '2024-01-02T00:00:00.000Z'
};

function cursorPage<T>(data: T[], nextCursor: string | null = null) {
  return {
    data,
    meta: { nextCursor, hasMore: nextCursor !== null, limit: 20 }
  };
}

describe('ActionsStore', () => {
  let rbacServiceMock: {
    getActionsCursor: ReturnType<typeof vi.fn>;
    createAction: ReturnType<typeof vi.fn>;
    updateAction: ReturnType<typeof vi.fn>;
    deleteAction: ReturnType<typeof vi.fn>;
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
      getActionsCursor: vi.fn().mockReturnValue(of(cursorPage([mockAction]))),
      createAction: vi.fn(),
      updateAction: vi.fn(),
      deleteAction: vi.fn()
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
        ActionsStore,
        { provide: RbacAdminService, useValue: rbacServiceMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: NotifyService, useValue: notifyMock }
      ]
    });

    return TestBed.inject(ActionsStore);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  describe('load()', () => {
    it('asks for the first page and fills the collection', async () => {
      const store = createStore();
      store.load();
      await vi.waitFor(() => expect(store.loading()).toBe(false));

      expect(rbacServiceMock.getActionsCursor).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: null })
      );
      expect(store.actions()).toEqual([mockAction]);
    });

    it('appends the next page behind the cursor', async () => {
      const store = createStore();
      rbacServiceMock.getActionsCursor.mockReturnValue(
        of(cursorPage([mockAction], 'cur-1'))
      );
      store.load();
      await vi.waitFor(() => expect(store.actions()).toHaveLength(1));

      rbacServiceMock.getActionsCursor.mockReturnValue(
        of(cursorPage([mockAction2]))
      );
      store.loadMore();
      await vi.waitFor(() => expect(store.actions()).toHaveLength(2));

      expect(rbacServiceMock.getActionsCursor).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: 'cur-1' })
      );
    });

    it('shows a snackbar on error', async () => {
      const store = createStore();
      rbacServiceMock.getActionsCursor.mockReturnValue(
        throwError(() => new Error('boom'))
      );
      store.load();
      await vi.waitFor(() => expect(store.loading()).toBe(false));

      expect(notifyMock.error).toHaveBeenCalledWith(
        expect.anything(),
        'admin.store.errorLoadActionsFailed'
      );
    });
  });

  describe('createAction()', () => {
    it('adds the row to the loaded page and refreshes the metadata', async () => {
      const store = createStore();
      store.load();
      await vi.waitFor(() => expect(store.actions()).toHaveLength(1));

      rbacServiceMock.createAction.mockReturnValue(of(mockAction2));
      await firstValueFrom(
        store.createAction({ name: 'write', displayName: 'Write' })
      );

      expect(store.actions().map((a) => a.id)).toContain('act-2');
      expect(authServiceMock.fetchRbacMetadata).toHaveBeenCalled();
    });
  });

  describe('updateAction()', () => {
    it('replaces the row and refreshes the metadata', async () => {
      const store = createStore();
      store.load();
      await vi.waitFor(() => expect(store.actions()).toHaveLength(1));

      rbacServiceMock.updateAction.mockReturnValue(
        of({ ...mockAction, displayName: 'Read only' })
      );
      await firstValueFrom(
        store.updateAction('act-1', { displayName: 'Read only' })
      );

      expect(store.actions()[0].displayName).toBe('Read only');
      expect(authServiceMock.fetchRbacMetadata).toHaveBeenCalled();
    });
  });

  describe('deleteAction()', () => {
    it('removes the row and refreshes the metadata', async () => {
      const store = createStore();
      store.load();
      await vi.waitFor(() => expect(store.actions()).toHaveLength(1));

      rbacServiceMock.deleteAction.mockReturnValue(of(undefined));
      await firstValueFrom(store.deleteAction('act-1'));

      expect(store.actions()).toEqual([]);
      expect(authServiceMock.fetchRbacMetadata).toHaveBeenCalled();
    });
  });
});
