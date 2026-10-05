import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { config, of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import type { Sort } from '@angular/material/sort';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

import { UserListComponent } from './user-list.component';
import { UsersStore } from '../../store/users.store';
import { NotifyService } from '@core/services/notify.service';
import { RoleCatalogService } from '@core/services/role-catalog.service';
import type { User } from '../../models/user.types';
import type { RoleAdminResponse } from '@app/shared/types';
import { USER_LIST_QUERY } from '@app/shared/constants';
import type { UserSearch } from '../../models/user.types';
import { listUrlStoreMock } from '../../../../../test-utils/list-store-mock';

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
  hasPassword: true,
  mfaEnabled: false,
  locale: 'en',
  lockedUntil: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  deletedAt: null
};

describe('UserListComponent', () => {
  let component: UserListComponent;
  let fixture: ComponentFixture<UserListComponent>;
  let observeSpy: ReturnType<typeof vi.fn>;
  let disconnectSpy: ReturnType<typeof vi.fn>;
  function createUsersStoreMock() {
    return {
      ...listUrlStoreMock(USER_LIST_QUERY, 'users'),
      loading: signal(false),
      isLoadingMore: signal(false),
      totalUsers: signal(0),
      displayedUsers: signal<User[]>([]),
      hasMore: signal(false),
      filters: signal<UserSearch>({}),
      loadMore: vi.fn(),
      deleteUser: vi.fn().mockReturnValue(of(void 0)),
      restoreUser: vi.fn().mockReturnValue(of(mockUser))
    };
  }
  let usersStoreMock: ReturnType<typeof createUsersStoreMock>;
  let navigateSpy: ReturnType<typeof vi.spyOn>;
  let notifyMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
  let dialogMock: { open: ReturnType<typeof vi.fn> };
  let roleCatalogMock: { getAll: ReturnType<typeof vi.fn> };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    observeSpy = vi.fn();
    disconnectSpy = vi.fn();
    class MockIntersectionObserver {
      observe = observeSpy;
      disconnect = disconnectSpy;
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

    usersStoreMock = createUsersStoreMock();

    notifyMock = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    };
    dialogMock = { open: vi.fn() };
    roleCatalogMock = { getAll: vi.fn().mockReturnValue(of([mockUserRole])) };

    await TestBed.configureTestingModule({
      imports: [UserListComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: UsersStore, useValue: usersStoreMock },
        { provide: NotifyService, useValue: notifyMock },
        { provide: MatDialog, useValue: dialogMock },
        { provide: RoleCatalogService, useValue: roleCatalogMock }
      ]
    }).compileComponents();

    navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate');
    fixture = TestBed.createComponent(UserListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads the first page once on init, with the state of the URL', () => {
    expect(usersStoreMock.setFilters).toHaveBeenCalledWith({});
    expect(usersStoreMock.setSorting).toHaveBeenCalledWith('createdAt', 'desc');
    expect(usersStoreMock.load).toHaveBeenCalledTimes(1);
  });

  it('applies a list param that the URL gets later, and loads once more', async () => {
    await TestBed.inject(Router).navigate([], {
      queryParams: { 'users.q': 'bob', 'users.sortBy': 'email' }
    });

    expect(usersStoreMock.setFilters).toHaveBeenLastCalledWith({ q: 'bob' });
    expect(usersStoreMock.setSorting).toHaveBeenLastCalledWith('email', 'desc');
    expect(usersStoreMock.load).toHaveBeenCalledTimes(2);
  });

  it('should fetch roles on init and expose them for the filter select', () => {
    expect(roleCatalogMock.getAll).toHaveBeenCalled();
    expect(component.roles()).toEqual([mockUserRole]);
  });

  it('reports no unhandled error when the role catalog is refused', () => {
    const unhandled = vi.fn();
    config.onUnhandledError = unhandled;
    vi.useFakeTimers();
    try {
      roleCatalogMock.getAll.mockReturnValue(
        throwError(() => new Error('503'))
      );
      const refused = TestBed.createComponent(UserListComponent);
      refused.detectChanges();
      vi.runOnlyPendingTimers();

      expect(unhandled).not.toHaveBeenCalled();
      expect(refused.componentInstance.roles()).toEqual([]);
    } finally {
      vi.useRealTimers();
      config.onUnhandledError = null;
    }
  });

  function lastNavigation(): {
    queryParams: Record<string, string | null>;
    replaceUrl: boolean;
  } {
    return navigateSpy.mock.lastCall?.[1] as {
      queryParams: Record<string, string | null>;
      replaceUrl: boolean;
    };
  }

  describe('sortData', () => {
    it('writes the default sort (no sort params) when direction is empty', () => {
      component.sortData({ active: 'email', direction: '' } satisfies Sort);

      expect(lastNavigation().queryParams).toMatchObject({
        'users.sortBy': null,
        'users.sortOrder': null
      });
      expect(lastNavigation().replaceUrl).toBe(false);
    });

    it('writes the sort of the email column', () => {
      component.sortData({ active: 'email', direction: 'asc' });

      expect(lastNavigation().queryParams).toMatchObject({
        'users.sortBy': 'email',
        'users.sortOrder': 'asc'
      });
    });

    it('maps the name column to firstName', () => {
      component.sortData({ active: 'name', direction: 'desc' });

      expect(lastNavigation().queryParams).toMatchObject({
        'users.sortBy': 'firstName',
        'users.sortOrder': null
      });
    });

    it('writes the default sort for a column with no sort key', () => {
      component.sortData({ active: 'unknown', direction: 'asc' });

      expect(lastNavigation().queryParams).toMatchObject({
        'users.sortBy': null,
        'users.sortOrder': null
      });
    });

    it('marks the sorted column in the table, and none for the default sort', () => {
      expect(component.sort()).toEqual({ active: '', direction: '' });

      usersStoreMock.sortBy.set('firstName');
      usersStoreMock.sortOrder.set('asc');

      expect(component.sort()).toEqual({ active: 'name', direction: 'asc' });
    });
  });

  describe('filters', () => {
    it('writes the next filters to the URL and does not load by itself', () => {
      component.applyFilters({ q: 'alice', isActive: false });

      expect(lastNavigation().queryParams).toMatchObject({
        'users.q': 'alice',
        'users.isActive': 'false',
        'users.role': null
      });
      expect(lastNavigation().replaceUrl).toBe(false);
      expect(usersStoreMock.load).toHaveBeenCalledTimes(1);
    });

    it('replaces the history entry when only the search changes', () => {
      component.applyFilters({ q: 'alice' });

      expect(lastNavigation().replaceUrl).toBe(true);
    });

    it('offers the catalog roles as literal options, then the account-state selects and the deleted toggle', () => {
      const controls = component.filterControls();
      const [role, status] = controls;
      const deleted = controls[controls.length - 1];

      expect(controls.map((control) => control.key)).toEqual([
        'role',
        'isActive',
        'isEmailVerified',
        'mfaEnabled',
        'isLocked',
        'hasPassword',
        'includeDeleted'
      ]);

      expect(role).toMatchObject({
        kind: 'select',
        key: 'role',
        options: [{ value: 'user', label: 'user', literal: true }]
      });
      expect(status).toMatchObject({
        kind: 'select',
        key: 'isActive',
        options: [
          { value: true, label: 'common.active' },
          { value: false, label: 'common.inactive' }
        ]
      });
      expect(deleted).toMatchObject({
        kind: 'checkbox',
        key: 'includeDeleted'
      });
    });

    it('renders the search box and no Search or Clear button', () => {
      const host = fixture.nativeElement as HTMLElement;

      expect(host.querySelector('nxs-list-filters input')).not.toBeNull();
      expect(host.querySelector('button[type="submit"]')).toBeNull();
    });
  });

  describe('confirmDelete', () => {
    it('should open confirm dialog', () => {
      const dialogRefMock = {
        afterClosed: vi.fn().mockReturnValue(of(false))
      };
      dialogMock.open.mockReturnValue(dialogRefMock);

      component.confirmDelete(mockUser);

      expect(dialogMock.open).toHaveBeenCalled();
    });

    it('should delete user inline (no reload) when dialog confirmed', () => {
      const dialogRefMock = {
        afterClosed: vi.fn().mockReturnValue(of(true))
      };
      dialogMock.open.mockReturnValue(dialogRefMock);

      component.confirmDelete(mockUser);

      expect(usersStoreMock.deleteUser).toHaveBeenCalledWith('user-1');
      expect(notifyMock.success).toHaveBeenCalledWith(
        'users.list.successDeleted'
      );
      expect(usersStoreMock.load).toHaveBeenCalledTimes(1); // only on init
    });

    it('should not delete when dialog is cancelled', () => {
      const dialogRefMock = {
        afterClosed: vi.fn().mockReturnValue(of(false))
      };
      dialogMock.open.mockReturnValue(dialogRefMock);

      component.confirmDelete(mockUser);

      expect(usersStoreMock.deleteUser).not.toHaveBeenCalled();
    });

    it('should show error snackbar when delete fails', () => {
      usersStoreMock.deleteUser.mockReturnValue(
        throwError(() => new Error('Network error'))
      );
      const dialogRefMock = {
        afterClosed: vi.fn().mockReturnValue(of(true))
      };
      dialogMock.open.mockReturnValue(dialogRefMock);

      component.confirmDelete(mockUser);

      expect(notifyMock.error).toHaveBeenCalledWith(
        'users.list.errorDeleteFailed'
      );
    });
  });

  describe('confirmRestore', () => {
    const deletedUser: User = {
      ...mockUser,
      deletedAt: '2024-02-01T00:00:00.000Z'
    };

    it('should restore inline (no reload) when the dialog is confirmed', () => {
      dialogMock.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(true))
      });

      component.confirmRestore(deletedUser);

      expect(usersStoreMock.restoreUser).toHaveBeenCalledWith('user-1');
      expect(notifyMock.success).toHaveBeenCalledWith(
        'users.list.successRestored'
      );
      expect(usersStoreMock.load).toHaveBeenCalledTimes(1); // only on init
    });

    it('should not restore when the dialog is cancelled', () => {
      dialogMock.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(false))
      });

      component.confirmRestore(deletedUser);

      expect(usersStoreMock.restoreUser).not.toHaveBeenCalled();
    });

    it('should show an error snackbar when restore fails', () => {
      usersStoreMock.restoreUser.mockReturnValue(
        throwError(() => new Error('Network error'))
      );
      dialogMock.open.mockReturnValue({
        afterClosed: vi.fn().mockReturnValue(of(true))
      });

      component.confirmRestore(deletedUser);

      expect(notifyMock.error).toHaveBeenCalledWith(
        'users.list.errorRestoreFailed'
      );
    });
  });
});
