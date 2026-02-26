import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import type { Sort } from '@angular/material/sort';

import { UserListComponent } from './user-list.component';
import { UsersStore } from '../../store/users.store';
import type { User } from '../../models/user.types';

const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  roles: ['user'],
  isActive: true,
  isEmailVerified: true,
  failedLoginAttempts: 0,
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
  let usersStoreMock: {
    listLoading: ReturnType<typeof signal<boolean>>;
    isLoadingMore: ReturnType<typeof signal<boolean>>;
    totalUsers: ReturnType<typeof signal<number>>;
    displayedUsers: ReturnType<typeof signal<User[]>>;
    hasMore: ReturnType<typeof signal<boolean>>;
    loadAll: ReturnType<typeof vi.fn>;
    loadMore: ReturnType<typeof vi.fn>;
    setSorting: ReturnType<typeof vi.fn>;
    deleteUser: ReturnType<typeof vi.fn>;
  };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };
  let dialogMock: { open: ReturnType<typeof vi.fn> };

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

    usersStoreMock = {
      listLoading: signal(false),
      isLoadingMore: signal(false),
      totalUsers: signal(0),
      displayedUsers: signal([]),
      hasMore: signal(false),
      loadAll: vi.fn(),
      loadMore: vi.fn(),
      setSorting: vi.fn(),
      deleteUser: vi.fn().mockReturnValue(of(void 0))
    };

    snackBarMock = { open: vi.fn() };
    dialogMock = { open: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [UserListComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: UsersStore, useValue: usersStoreMock },
        { provide: MatSnackBar, useValue: snackBarMock },
        { provide: MatDialog, useValue: dialogMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UserListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should call loadAll on init', () => {
    expect(usersStoreMock.loadAll).toHaveBeenCalled();
  });

  describe('sortData', () => {
    it('should reset to default sort when direction is empty', () => {
      const sort: Sort = { active: 'email', direction: '' };

      component.sortData(sort);

      expect(usersStoreMock.setSorting).toHaveBeenCalledWith(
        'createdAt',
        'desc'
      );
      expect(usersStoreMock.loadAll).toHaveBeenCalledTimes(2);
    });

    it('should sort by email column', () => {
      const sort: Sort = { active: 'email', direction: 'asc' };

      component.sortData(sort);

      expect(usersStoreMock.setSorting).toHaveBeenCalledWith('email', 'asc');
    });

    it('should sort by name column (mapped to firstName)', () => {
      const sort: Sort = { active: 'name', direction: 'desc' };

      component.sortData(sort);

      expect(usersStoreMock.setSorting).toHaveBeenCalledWith(
        'firstName',
        'desc'
      );
    });

    it('should fall back to createdAt for unknown column', () => {
      const sort: Sort = { active: 'unknown', direction: 'asc' };

      component.sortData(sort);

      expect(usersStoreMock.setSorting).toHaveBeenCalledWith(
        'createdAt',
        'asc'
      );
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
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'User deleted successfully',
        'Close',
        { duration: 5000 }
      );
      expect(usersStoreMock.loadAll).toHaveBeenCalledTimes(1); // only on init
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

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Failed to delete user. Please try again.',
        'Close',
        { duration: 5000 }
      );
    });
  });
});
