import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import type { PageEvent } from '@angular/material/paginator';
import type { Sort } from '@angular/material/sort';

import { UserListComponent } from './user-list.component';
import { UsersStore } from '../../store/users.store';
import type { User } from '../../models/user.types';

const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  isAdmin: false,
  isActive: true,
  isEmailVerified: true,
  failedLoginAttempts: 0,
  lockedUntil: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

describe('UserListComponent', () => {
  let component: UserListComponent;
  let fixture: ComponentFixture<UserListComponent>;
  let usersStoreMock: {
    listLoading: ReturnType<typeof signal<boolean>>;
    totalUsers: ReturnType<typeof signal<number>>;
    pageSize: ReturnType<typeof signal<number>>;
    currentPage: ReturnType<typeof signal<number>>;
    displayedUsers: ReturnType<typeof signal<User[]>>;
    loadAll: ReturnType<typeof vi.fn>;
    setPage: ReturnType<typeof vi.fn>;
    setPageSize: ReturnType<typeof vi.fn>;
    setSorting: ReturnType<typeof vi.fn>;
    deleteUser: ReturnType<typeof vi.fn>;
  };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };
  let dialogMock: { open: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    usersStoreMock = {
      listLoading: signal(false),
      totalUsers: signal(0),
      pageSize: signal(10),
      currentPage: signal(0),
      displayedUsers: signal([]),
      loadAll: vi.fn(),
      setPage: vi.fn(),
      setPageSize: vi.fn(),
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

  describe('handlePageEvent', () => {
    it('should call setPageSize and loadAll when page size changes', () => {
      const event: PageEvent = { pageIndex: 0, pageSize: 25, length: 100 };
      usersStoreMock.pageSize.set(10); // current size is 10, event is 25

      component.handlePageEvent(event);

      expect(usersStoreMock.setPageSize).toHaveBeenCalledWith(25);
      expect(usersStoreMock.loadAll).toHaveBeenCalledTimes(2); // once on init, once on page event
    });

    it('should call setPage and loadAll when page index changes', () => {
      const event: PageEvent = { pageIndex: 2, pageSize: 10, length: 100 };
      usersStoreMock.pageSize.set(10); // same size

      component.handlePageEvent(event);

      expect(usersStoreMock.setPage).toHaveBeenCalledWith(2);
      expect(usersStoreMock.loadAll).toHaveBeenCalledTimes(2);
    });
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

    it('should delete user and reload when dialog confirmed', () => {
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
      expect(usersStoreMock.loadAll).toHaveBeenCalledTimes(2); // init + after delete
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
