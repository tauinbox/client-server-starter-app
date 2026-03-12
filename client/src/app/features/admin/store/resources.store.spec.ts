import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

import { ResourcesStore } from './resources.store';
import { RbacAdminService } from '../services/rbac-admin.service';
import { AuthService } from '@features/auth/services/auth.service';
import type {
  ResourceResponse,
  ActionResponse
} from '@app/shared/types/rbac.types';

const mockResource: ResourceResponse = {
  id: 'res-1',
  name: 'user',
  subject: 'User',
  displayName: 'Users',
  description: 'User management',
  isSystem: true,
  createdAt: '2024-01-01T00:00:00.000Z'
};

const mockResource2: ResourceResponse = {
  id: 'res-2',
  name: 'role',
  subject: 'Role',
  displayName: 'Roles',
  description: null,
  isSystem: true,
  createdAt: '2024-01-01T00:00:00.000Z'
};

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

describe('ResourcesStore', () => {
  let rbacServiceMock: {
    getResources: ReturnType<typeof vi.fn>;
    getActions: ReturnType<typeof vi.fn>;
    updateResource: ReturnType<typeof vi.fn>;
    createAction: ReturnType<typeof vi.fn>;
    updateAction: ReturnType<typeof vi.fn>;
    deleteAction: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: { fetchRbacMetadata: ReturnType<typeof vi.fn> };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };

  function createStore() {
    rbacServiceMock = {
      getResources: vi.fn().mockReturnValue(of([mockResource])),
      getActions: vi.fn().mockReturnValue(of([mockAction])),
      updateResource: vi.fn(),
      createAction: vi.fn(),
      updateAction: vi.fn(),
      deleteAction: vi.fn()
    };

    authServiceMock = {
      fetchRbacMetadata: vi.fn().mockResolvedValue(undefined)
    };

    snackBarMock = { open: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        ResourcesStore,
        { provide: RbacAdminService, useValue: rbacServiceMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: MatSnackBar, useValue: snackBarMock }
      ]
    });

    return TestBed.inject(ResourcesStore);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  describe('load()', () => {
    it('fetches resources and actions in parallel, sets both arrays in state', () => {
      rbacServiceMock = {
        getResources: vi
          .fn()
          .mockReturnValue(of([mockResource, mockResource2])),
        getActions: vi.fn().mockReturnValue(of([mockAction, mockAction2])),
        updateResource: vi.fn(),
        createAction: vi.fn(),
        updateAction: vi.fn(),
        deleteAction: vi.fn()
      };
      authServiceMock = {
        fetchRbacMetadata: vi.fn().mockResolvedValue(undefined)
      };
      snackBarMock = { open: vi.fn() };

      TestBed.configureTestingModule({
        providers: [
          ResourcesStore,
          { provide: RbacAdminService, useValue: rbacServiceMock },
          { provide: AuthService, useValue: authServiceMock },
          { provide: MatSnackBar, useValue: snackBarMock }
        ]
      });

      const store = TestBed.inject(ResourcesStore);
      store.load();

      expect(rbacServiceMock.getResources).toHaveBeenCalled();
      expect(rbacServiceMock.getActions).toHaveBeenCalled();
      expect(store.resources()).toEqual([mockResource, mockResource2]);
      expect(store.actions()).toEqual([mockAction, mockAction2]);
      expect(store.loading()).toBe(false);
    });

    it('shows snackbar on error', () => {
      rbacServiceMock = {
        getResources: vi
          .fn()
          .mockReturnValue(throwError(() => new Error('Network error'))),
        getActions: vi.fn().mockReturnValue(of([])),
        updateResource: vi.fn(),
        createAction: vi.fn(),
        updateAction: vi.fn(),
        deleteAction: vi.fn()
      };
      authServiceMock = {
        fetchRbacMetadata: vi.fn().mockResolvedValue(undefined)
      };
      snackBarMock = { open: vi.fn() };

      TestBed.configureTestingModule({
        providers: [
          ResourcesStore,
          { provide: RbacAdminService, useValue: rbacServiceMock },
          { provide: AuthService, useValue: authServiceMock },
          { provide: MatSnackBar, useValue: snackBarMock }
        ]
      });

      const store = TestBed.inject(ResourcesStore);
      store.load();

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Failed to load resources. Please try again.',
        'Close',
        { duration: 5000 }
      );
      expect(store.loading()).toBe(false);
    });
  });

  describe('updateResource()', () => {
    it('replaces item in resources array and calls authService.fetchRbacMetadata', () => {
      const store = createStore();
      store.load(); // seed resources: [mockResource]

      const updatedResource: ResourceResponse = {
        ...mockResource,
        displayName: 'Updated Users'
      };
      rbacServiceMock.updateResource.mockReturnValue(of(updatedResource));

      let result: ResourceResponse | undefined;
      store
        .updateResource('res-1', { displayName: 'Updated Users' })
        .subscribe((r) => {
          result = r;
        });

      expect(result).toEqual(updatedResource);
      expect(store.resources()).toEqual([updatedResource]);
      expect(authServiceMock.fetchRbacMetadata).toHaveBeenCalled();
    });
  });

  describe('createAction()', () => {
    it('appends to actions array, sorts by name, and calls authService.fetchRbacMetadata', () => {
      const store = createStore();
      store.load(); // seed actions: [mockAction (read)]

      const newAction: ActionResponse = {
        id: 'act-new',
        name: 'archive',
        displayName: 'Archive',
        description: '',
        isDefault: false,
        createdAt: '2024-01-03T00:00:00.000Z'
      };
      rbacServiceMock.createAction.mockReturnValue(of(newAction));

      store
        .createAction({
          name: 'archive',
          displayName: 'Archive'
        })
        .subscribe();

      // 'archive' < 'read' alphabetically
      expect(store.actions()[0].name).toBe('archive');
      expect(store.actions()[1].name).toBe('read');
      expect(authServiceMock.fetchRbacMetadata).toHaveBeenCalled();
    });
  });

  describe('updateAction()', () => {
    it('replaces item in actions array and calls authService.fetchRbacMetadata', () => {
      const store = createStore();
      store.load(); // seed actions: [mockAction]

      const updatedAction: ActionResponse = {
        ...mockAction,
        displayName: 'Read All'
      };
      rbacServiceMock.updateAction.mockReturnValue(of(updatedAction));

      let result: ActionResponse | undefined;
      store
        .updateAction('act-1', { displayName: 'Read All' })
        .subscribe((r) => {
          result = r;
        });

      expect(result).toEqual(updatedAction);
      expect(store.actions()).toEqual([updatedAction]);
      expect(authServiceMock.fetchRbacMetadata).toHaveBeenCalled();
    });
  });

  describe('deleteAction()', () => {
    it('removes item from actions array and calls authService.fetchRbacMetadata', () => {
      rbacServiceMock = {
        getResources: vi.fn().mockReturnValue(of([mockResource])),
        getActions: vi.fn().mockReturnValue(of([mockAction, mockAction2])),
        updateResource: vi.fn(),
        createAction: vi.fn(),
        updateAction: vi.fn(),
        deleteAction: vi.fn().mockReturnValue(of(undefined))
      };
      authServiceMock = {
        fetchRbacMetadata: vi.fn().mockResolvedValue(undefined)
      };
      snackBarMock = { open: vi.fn() };

      TestBed.configureTestingModule({
        providers: [
          ResourcesStore,
          { provide: RbacAdminService, useValue: rbacServiceMock },
          { provide: AuthService, useValue: authServiceMock },
          { provide: MatSnackBar, useValue: snackBarMock }
        ]
      });

      const store = TestBed.inject(ResourcesStore);
      store.load(); // seed actions: [mockAction, mockAction2]

      store.deleteAction('act-1').subscribe();

      expect(store.actions()).toEqual([mockAction2]);
      expect(authServiceMock.fetchRbacMetadata).toHaveBeenCalled();
    });
  });
});
