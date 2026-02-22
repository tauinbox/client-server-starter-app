import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';

import { UserEditComponent } from './user-edit.component';
import { UserService } from '../../services/user.service';
import { UsersStore } from '../../store/users.store';
import { AuthStore } from '../../../auth/store/auth.store';
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

describe('UserEditComponent', () => {
  let component: UserEditComponent;
  let fixture: ComponentFixture<UserEditComponent>;
  let userServiceMock: { getById: ReturnType<typeof vi.fn> };
  let usersStoreMock: {
    updateUser: ReturnType<typeof vi.fn>;
    deleteUser: ReturnType<typeof vi.fn>;
  };
  let isAdminSignal: WritableSignal<boolean>;
  let currentUserSignal: WritableSignal<{ id: string } | null>;
  let authStoreMock: {
    isAdmin: WritableSignal<boolean>;
    user: WritableSignal<{ id: string } | null>;
    updateCurrentUser: ReturnType<typeof vi.fn>;
  };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };
  let dialogMock: { open: ReturnType<typeof vi.fn> };
  let router: Router;

  beforeEach(async () => {
    isAdminSignal = signal(true);
    currentUserSignal = signal({ id: 'admin-id' });

    userServiceMock = {
      getById: vi.fn().mockReturnValue(of(mockUser))
    };

    usersStoreMock = {
      updateUser: vi.fn().mockReturnValue(of(mockUser)),
      deleteUser: vi.fn().mockReturnValue(of(void 0))
    };

    authStoreMock = {
      isAdmin: isAdminSignal,
      user: currentUserSignal,
      updateCurrentUser: vi.fn()
    };

    snackBarMock = { open: vi.fn() };
    dialogMock = { open: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [UserEditComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: UserService, useValue: userServiceMock },
        { provide: UsersStore, useValue: usersStoreMock },
        { provide: AuthStore, useValue: authStoreMock },
        { provide: MatSnackBar, useValue: snackBarMock },
        { provide: MatDialog, useValue: dialogMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UserEditComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.componentRef.setInput('id', 'user-1');
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('ngOnInit / loadUser', () => {
    it('should load user on init and patch form', () => {
      fixture.detectChanges();

      expect(userServiceMock.getById).toHaveBeenCalledWith('user-1');
      expect(component['user']()).toEqual(mockUser);
      expect(component['loading']()).toBe(false);
      expect(component['userForm'].value).toMatchObject({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        password: '',
        isAdmin: false,
        isActive: true
      });
    });

    it('should mark form as pristine after loading', () => {
      fixture.detectChanges();
      expect(component['userForm'].pristine).toBe(true);
    });

    it('should set error on load failure', () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Not found' },
        status: 404
      });
      userServiceMock.getById.mockReturnValue(throwError(() => httpError));

      fixture.detectChanges();

      expect(component['loading']()).toBe(false);
      expect(component['error']()).toBe('Not found');
    });

    it('should show fallback error when no server message', () => {
      const httpError = new HttpErrorResponse({ error: null, status: 500 });
      userServiceMock.getById.mockReturnValue(throwError(() => httpError));

      fixture.detectChanges();

      expect(component['error']()).toBe(
        'Failed to load user details. Please try again.'
      );
    });
  });

  describe('form validation', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should be valid after loading user data', () => {
      expect(component['userForm'].valid).toBe(true);
    });

    it('should require email', () => {
      component['userForm'].controls.email.setValue('');
      expect(component['userForm'].controls.email.hasError('required')).toBe(
        true
      );
    });

    it('should validate email format', () => {
      component['userForm'].controls.email.setValue('not-an-email');
      expect(component['userForm'].controls.email.hasError('email')).toBe(true);
    });

    it('should require firstName', () => {
      component['userForm'].controls.firstName.setValue('');
      expect(
        component['userForm'].controls.firstName.hasError('required')
      ).toBe(true);
    });

    it('should require lastName', () => {
      component['userForm'].controls.lastName.setValue('');
      expect(component['userForm'].controls.lastName.hasError('required')).toBe(
        true
      );
    });

    it('should accept empty password (optional field)', () => {
      component['userForm'].controls.password.setValue('');
      expect(component['userForm'].controls.password.valid).toBe(true);
    });

    it('should validate password minLength of 8', () => {
      component['userForm'].controls.password.setValue('short');
      expect(
        component['userForm'].controls.password.hasError('minlength')
      ).toBe(true);
    });

    it('should accept password of 8+ characters', () => {
      component['userForm'].controls.password.setValue('validpassword');
      expect(component['userForm'].controls.password.valid).toBe(true);
    });
  });

  describe('canSubmit', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should be false when form is pristine (not dirty)', () => {
      expect(component['canSubmit']()).toBe(false);
    });

    it('should be true when form is valid and dirty', () => {
      component['userForm'].controls.firstName.setValue('Changed');
      component['userForm'].markAsDirty();
      expect(component['canSubmit']()).toBe(true);
    });

    it('should be false when form is invalid', () => {
      component['userForm'].controls.email.setValue('');
      component['userForm'].markAsDirty();
      expect(component['canSubmit']()).toBe(false);
    });

    it('should be false when saving is in progress', () => {
      component['userForm'].markAsDirty();
      component['saving'].set(true);
      expect(component['canSubmit']()).toBe(false);
    });
  });

  describe('canDelete', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should be true when admin editing another user', () => {
      isAdminSignal.set(true);
      currentUserSignal.set({ id: 'admin-id' }); // not 'user-1'
      expect(component['canDelete']()).toBe(true);
    });

    it('should be false when editing own account', () => {
      isAdminSignal.set(true);
      currentUserSignal.set({ id: 'user-1' }); // same as the input id
      expect(component['canDelete']()).toBe(false);
    });

    it('should be false when not admin', () => {
      isAdminSignal.set(false);
      currentUserSignal.set({ id: 'admin-id' });
      expect(component['canDelete']()).toBe(false);
    });
  });

  describe('onSubmit', () => {
    beforeEach(() => {
      fixture.detectChanges();
      component['userForm'].markAsDirty();
    });

    it('should not submit when form is invalid', () => {
      component['userForm'].controls.email.setValue('');
      component.onSubmit();
      expect(usersStoreMock.updateUser).not.toHaveBeenCalled();
    });

    it('should call updateUser with form values (no password)', () => {
      component['userForm'].controls.password.setValue('');
      component.onSubmit();

      expect(usersStoreMock.updateUser).toHaveBeenCalledWith('user-1', {
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        isAdmin: false,
        isActive: true
      });
    });

    it('should include password when provided', () => {
      component['userForm'].controls.password.setValue('newPassword1');
      component.onSubmit();

      expect(usersStoreMock.updateUser).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ password: 'newPassword1' })
      );
    });

    it('should not include isAdmin/isActive when not admin', () => {
      isAdminSignal.set(false);
      component['userForm'].controls.password.setValue('');
      component.onSubmit();

      expect(usersStoreMock.updateUser).toHaveBeenCalledWith('user-1', {
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User'
      });
    });

    it('should show snackbar and navigate to user detail on success', () => {
      const navigateSpy = vi.spyOn(router, 'navigate');
      component.onSubmit();

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'User updated successfully',
        'Close',
        { duration: 5000 }
      );
      expect(navigateSpy).toHaveBeenCalledWith(['/users', 'user-1']);
    });

    it('should call updateCurrentUser when editing own account', () => {
      currentUserSignal.set({ id: 'user-1' });
      const updatedUser = { ...mockUser, firstName: 'Updated' };
      usersStoreMock.updateUser.mockReturnValue(of(updatedUser));

      component.onSubmit();

      expect(authStoreMock.updateCurrentUser).toHaveBeenCalledWith(updatedUser);
    });

    it('should not call updateCurrentUser when editing another user', () => {
      currentUserSignal.set({ id: 'admin-id' });
      component.onSubmit();

      expect(authStoreMock.updateCurrentUser).not.toHaveBeenCalled();
    });

    it('should reset password field and mark form pristine on success', () => {
      component['userForm'].controls.password.setValue('oldpassword1');
      component.onSubmit();

      expect(component['userForm'].controls.password.value).toBe('');
      expect(component['userForm'].pristine).toBe(true);
    });

    it('should set error on update failure', () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Update failed' },
        status: 400
      });
      usersStoreMock.updateUser.mockReturnValue(throwError(() => httpError));

      component.onSubmit();

      expect(component['error']()).toBe('Update failed');
      expect(component['saving']()).toBe(false);
    });

    it('should show fallback error when no server message on failure', () => {
      const httpError = new HttpErrorResponse({ error: null, status: 500 });
      usersStoreMock.updateUser.mockReturnValue(throwError(() => httpError));

      component.onSubmit();

      expect(component['error']()).toBe(
        'Failed to update user. Please try again.'
      );
    });
  });

  describe('unlockAccount', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should call updateUser with unlockAccount flag', () => {
      component.unlockAccount();

      expect(usersStoreMock.updateUser).toHaveBeenCalledWith('user-1', {
        unlockAccount: true
      });
    });

    it('should update user signal and show success snackbar', () => {
      const unlockedUser = { ...mockUser, failedLoginAttempts: 0 };
      usersStoreMock.updateUser.mockReturnValue(of(unlockedUser));

      component.unlockAccount();

      expect(component['user']()).toEqual(unlockedUser);
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Account unlocked successfully',
        'Close',
        { duration: 5000 }
      );
      expect(component['saving']()).toBe(false);
    });

    it('should show error snackbar on unlock failure', () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Unlock failed' },
        status: 400
      });
      usersStoreMock.updateUser.mockReturnValue(throwError(() => httpError));

      component.unlockAccount();

      expect(snackBarMock.open).toHaveBeenCalledWith('Unlock failed', 'Close', {
        duration: 5000
      });
      expect(component['saving']()).toBe(false);
    });

    it('should show fallback message when no server error message', () => {
      const httpError = new HttpErrorResponse({ error: null, status: 500 });
      usersStoreMock.updateUser.mockReturnValue(throwError(() => httpError));

      component.unlockAccount();

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Failed to unlock account',
        'Close',
        { duration: 5000 }
      );
    });
  });

  describe('confirmDelete', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should not open dialog when user is null', () => {
      component['user'].set(null);
      component.confirmDelete();

      expect(dialogMock.open).not.toHaveBeenCalled();
    });

    it('should open confirm dialog with user name in message', () => {
      const dialogRefMock = {
        afterClosed: vi.fn().mockReturnValue(of(false))
      };
      dialogMock.open.mockReturnValue(dialogRefMock);

      component.confirmDelete();

      expect(dialogMock.open).toHaveBeenCalled();
      const dialogData = dialogMock.open.mock.calls[0][1]['data'];
      expect(dialogData['message']).toContain('Test User');
    });

    it('should delete user and navigate to list when dialog confirmed', () => {
      const navigateSpy = vi.spyOn(router, 'navigate');
      const dialogRefMock = {
        afterClosed: vi.fn().mockReturnValue(of(true))
      };
      dialogMock.open.mockReturnValue(dialogRefMock);

      component.confirmDelete();

      expect(usersStoreMock.deleteUser).toHaveBeenCalledWith('user-1');
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'User deleted successfully',
        'Close',
        { duration: 5000 }
      );
      expect(navigateSpy).toHaveBeenCalledWith(['/users']);
    });

    it('should not delete when dialog is cancelled', () => {
      const dialogRefMock = {
        afterClosed: vi.fn().mockReturnValue(of(false))
      };
      dialogMock.open.mockReturnValue(dialogRefMock);

      component.confirmDelete();

      expect(usersStoreMock.deleteUser).not.toHaveBeenCalled();
    });

    it('should show error snackbar when delete fails', () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Delete failed' },
        status: 500
      });
      usersStoreMock.deleteUser.mockReturnValue(throwError(() => httpError));
      const dialogRefMock = {
        afterClosed: vi.fn().mockReturnValue(of(true))
      };
      dialogMock.open.mockReturnValue(dialogRefMock);

      component.confirmDelete();

      expect(snackBarMock.open).toHaveBeenCalledWith('Delete failed', 'Close', {
        duration: 5000
      });
    });

    it('should show fallback message when delete fails without server message', () => {
      const httpError = new HttpErrorResponse({ error: null, status: 500 });
      usersStoreMock.deleteUser.mockReturnValue(throwError(() => httpError));
      const dialogRefMock = {
        afterClosed: vi.fn().mockReturnValue(of(true))
      };
      dialogMock.open.mockReturnValue(dialogRefMock);

      component.confirmDelete();

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Failed to delete user. Please try again.',
        'Close',
        { duration: 5000 }
      );
    });
  });
});
