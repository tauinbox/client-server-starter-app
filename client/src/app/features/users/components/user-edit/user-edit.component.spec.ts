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
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

import { UserEditComponent } from './user-edit.component';
import { UserService } from '../../services/user.service';
import { RoleService } from '../../../admin/services/role.service';
import { UsersStore } from '../../store/users.store';
import { AuthStore } from '../../../auth/store/auth.store';
import type { User } from '../../models/user.types';
import type { RoleResponse } from '@app/shared/types';
import { SYSTEM_ROLES } from '@app/shared/constants';

const mockUserRole: RoleResponse = {
  id: 'role-user',
  name: SYSTEM_ROLES.USER,
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
  lockedUntil: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  deletedAt: null
};

describe('UserEditComponent', () => {
  let component: UserEditComponent;
  let fixture: ComponentFixture<UserEditComponent>;
  let userServiceMock: { getById: ReturnType<typeof vi.fn> };
  let roleServiceMock: {
    getAll: ReturnType<typeof vi.fn>;
    assignRoleToUser: ReturnType<typeof vi.fn>;
    removeRoleFromUser: ReturnType<typeof vi.fn>;
  };
  let usersStoreMock: {
    updateUser: ReturnType<typeof vi.fn>;
    deleteUser: ReturnType<typeof vi.fn>;
  };
  let permittedSignal: WritableSignal<boolean>;
  let currentUserSignal: WritableSignal<{ id: string } | null>;
  let authStoreMock: {
    hasPermissions: ReturnType<typeof vi.fn>;
    user: WritableSignal<{ id: string } | null>;
    updateCurrentUser: ReturnType<typeof vi.fn>;
  };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };
  let dialogMock: { open: ReturnType<typeof vi.fn> };
  let router: Router;

  beforeEach(async () => {
    permittedSignal = signal(true);
    currentUserSignal = signal({ id: 'admin-id' });

    userServiceMock = {
      getById: vi.fn().mockReturnValue(of(mockUser))
    };

    roleServiceMock = {
      getAll: vi.fn().mockReturnValue(of([])),
      assignRoleToUser: vi.fn().mockReturnValue(of(void 0)),
      removeRoleFromUser: vi.fn().mockReturnValue(of(void 0))
    };

    usersStoreMock = {
      updateUser: vi.fn().mockReturnValue(of(mockUser)),
      deleteUser: vi.fn().mockReturnValue(of(void 0))
    };

    authStoreMock = {
      hasPermissions: vi.fn().mockImplementation(() => permittedSignal()),
      user: currentUserSignal,
      updateCurrentUser: vi.fn()
    };

    snackBarMock = { open: vi.fn() };
    dialogMock = { open: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [UserEditComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: UserService, useValue: userServiceMock },
        { provide: RoleService, useValue: roleServiceMock },
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
    it('should load user on init and set model', () => {
      fixture.detectChanges();

      expect(userServiceMock.getById).toHaveBeenCalledWith('user-1');
      expect(component['user']()).toEqual(mockUser);
      expect(component['loading']()).toBe(false);
      expect(component.userModel()).toEqual({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        password: ''
      });
    });

    it('should reset form dirty state after loading', () => {
      fixture.detectChanges();
      expect(component.userForm().dirty()).toBe(false);
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
      expect(component.userForm().valid()).toBe(true);
    });

    it('should require email', () => {
      component.userModel.set({
        email: '',
        firstName: 'Test',
        lastName: 'User',
        password: ''
      });
      TestBed.tick();
      const errors = component.userForm.email().errors();
      expect(errors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should validate email format', () => {
      component.userModel.set({
        email: 'not-an-email',
        firstName: 'Test',
        lastName: 'User',
        password: ''
      });
      TestBed.tick();
      const errors = component.userForm.email().errors();
      expect(errors.some((e) => e.kind === 'email')).toBe(true);
    });

    it('should require firstName', () => {
      component.userModel.set({
        email: 'test@example.com',
        firstName: '',
        lastName: 'User',
        password: ''
      });
      TestBed.tick();
      const errors = component.userForm.firstName().errors();
      expect(errors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should require lastName', () => {
      component.userModel.set({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: '',
        password: ''
      });
      TestBed.tick();
      const errors = component.userForm.lastName().errors();
      expect(errors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should accept empty password (optional field)', () => {
      component.userModel.set({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        password: ''
      });
      TestBed.tick();
      expect(component.userForm().valid()).toBe(true);
    });

    it('should validate password minLength of 8', () => {
      component.userModel.set({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        password: 'short'
      });
      TestBed.tick();
      const errors = component.userForm.password().errors();
      expect(errors.some((e) => e.kind === 'minLength')).toBe(true);
    });

    it('should accept password of 8+ characters', () => {
      component.userModel.set({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        password: 'validpassword'
      });
      TestBed.tick();
      expect(component.userForm().valid()).toBe(true);
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
      component.userModel.set({
        email: 'test@example.com',
        firstName: 'Changed',
        lastName: 'User',
        password: ''
      });
      TestBed.tick();
      expect(component['canSubmit']()).toBe(true);
    });

    it('should be false when form is invalid', () => {
      component.userModel.set({
        email: '',
        firstName: 'Test',
        lastName: 'User',
        password: ''
      });
      TestBed.tick();
      expect(component['canSubmit']()).toBe(false);
    });

    it('should be false when saving is in progress', () => {
      component.userModel.set({
        email: 'test@example.com',
        firstName: 'Changed',
        lastName: 'User',
        password: ''
      });
      TestBed.tick();
      component['saving'].set(true);
      expect(component['canSubmit']()).toBe(false);
    });
  });

  describe('canManageUser (instance-level)', () => {
    it('should return false when user is not loaded', () => {
      expect(component['canManageUser']()).toBe(false);
    });

    it('should return true when hasPermissions returns true for instance', () => {
      fixture.detectChanges();
      permittedSignal.set(true);
      expect(component['canManageUser']()).toBe(true);
    });

    it('should return false when hasPermissions returns false for instance', () => {
      fixture.detectChanges();
      permittedSignal.set(false);
      expect(component['canManageUser']()).toBe(false);
    });

    it('should pass instance with user id to hasPermissions', () => {
      fixture.detectChanges();
      component['canManageUser']();

      expect(authStoreMock.hasPermissions).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          subject: 'User',
          instance: expect.objectContaining({ id: 'user-1' })
        })
      );
    });
  });

  describe('canDelete (instance-level)', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should be true when permitted editing another user', () => {
      permittedSignal.set(true);
      currentUserSignal.set({ id: 'admin-id' });
      expect(component['canDelete']()).toBe(true);
    });

    it('should be false when editing own account', () => {
      permittedSignal.set(true);
      currentUserSignal.set({ id: 'user-1' });
      expect(component['canDelete']()).toBe(false);
    });

    it('should be false when lacking delete permission', () => {
      permittedSignal.set(false);
      currentUserSignal.set({ id: 'admin-id' });
      expect(component['canDelete']()).toBe(false);
    });

    it('should return false when user is not loaded', () => {
      component['user'].set(null);
      permittedSignal.set(true);
      currentUserSignal.set({ id: 'admin-id' });
      expect(component['canDelete']()).toBe(false);
    });

    it('should pass instance with user id to hasPermissions', () => {
      permittedSignal.set(true);
      currentUserSignal.set({ id: 'admin-id' });
      component['canDelete']();

      expect(authStoreMock.hasPermissions).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'delete',
          subject: 'User',
          instance: expect.objectContaining({ id: 'user-1' })
        })
      );
    });
  });

  describe('onSubmit', () => {
    beforeEach(() => {
      fixture.detectChanges();
      // Make form dirty by changing a value
      component.userModel.set({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        password: ''
      });
      TestBed.tick();
    });

    it('should not submit when form is invalid', () => {
      component.userModel.set({
        email: '',
        firstName: 'Test',
        lastName: 'User',
        password: ''
      });
      TestBed.tick();
      component.onSubmit();
      expect(usersStoreMock.updateUser).not.toHaveBeenCalled();
    });

    it('should call updateUser with form values (no password)', () => {
      component.userModel.set({
        email: 'test@example.com',
        firstName: 'Changed',
        lastName: 'User',
        password: ''
      });
      TestBed.tick();
      component.onSubmit();

      expect(usersStoreMock.updateUser).toHaveBeenCalledWith('user-1', {
        email: 'test@example.com',
        firstName: 'Changed',
        lastName: 'User',
        isActive: true
      });
    });

    it('should include password when provided', () => {
      component.userModel.set({
        email: 'test@example.com',
        firstName: 'Changed',
        lastName: 'User',
        password: 'newPassword1'
      });
      TestBed.tick();
      component.onSubmit();

      expect(usersStoreMock.updateUser).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ password: 'newPassword1' })
      );
    });

    it('should not include isActive when lacking update permission', () => {
      permittedSignal.set(false);
      component.userModel.set({
        email: 'test@example.com',
        firstName: 'Changed',
        lastName: 'User',
        password: ''
      });
      TestBed.tick();
      component.onSubmit();

      expect(usersStoreMock.updateUser).toHaveBeenCalledWith('user-1', {
        email: 'test@example.com',
        firstName: 'Changed',
        lastName: 'User'
      });
    });

    it('should show snackbar and navigate to user detail on success', () => {
      const navigateSpy = vi.spyOn(router, 'navigate');
      component.userModel.set({
        email: 'test@example.com',
        firstName: 'Changed',
        lastName: 'User',
        password: ''
      });
      TestBed.tick();
      component.onSubmit();

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'User updated successfully',
        'Close',
        { duration: 5000 }
      );
      expect(navigateSpy).toHaveBeenCalledWith(['/admin', 'users', 'user-1']);
    });

    it('should call updateCurrentUser when editing own account', () => {
      currentUserSignal.set({ id: 'user-1' });
      const updatedUser = { ...mockUser, firstName: 'Updated' };
      usersStoreMock.updateUser.mockReturnValue(of(updatedUser));

      component.userModel.set({
        email: 'test@example.com',
        firstName: 'Updated',
        lastName: 'User',
        password: ''
      });
      TestBed.tick();
      component.onSubmit();

      expect(authStoreMock.updateCurrentUser).toHaveBeenCalledWith(updatedUser);
    });

    it('should not call updateCurrentUser when editing another user', () => {
      currentUserSignal.set({ id: 'admin-id' });
      component.userModel.set({
        email: 'test@example.com',
        firstName: 'Changed',
        lastName: 'User',
        password: ''
      });
      TestBed.tick();
      component.onSubmit();

      expect(authStoreMock.updateCurrentUser).not.toHaveBeenCalled();
    });

    it('should reset password field after successful update', () => {
      component.userModel.set({
        email: 'test@example.com',
        firstName: 'Changed',
        lastName: 'User',
        password: 'oldpassword1'
      });
      TestBed.tick();
      component.onSubmit();

      expect(component.userModel().password).toBe('');
    });

    it('should set error on update failure', () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Update failed' },
        status: 400
      });
      usersStoreMock.updateUser.mockReturnValue(throwError(() => httpError));

      component.userModel.set({
        email: 'test@example.com',
        firstName: 'Changed',
        lastName: 'User',
        password: ''
      });
      TestBed.tick();
      component.onSubmit();

      expect(component['error']()).toBe('Update failed');
      expect(component['saving']()).toBe(false);
    });

    it('should show fallback error when no server message on failure', () => {
      const httpError = new HttpErrorResponse({ error: null, status: 500 });
      usersStoreMock.updateUser.mockReturnValue(throwError(() => httpError));

      component.userModel.set({
        email: 'test@example.com',
        firstName: 'Changed',
        lastName: 'User',
        password: ''
      });
      TestBed.tick();
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
      const unlockedUser = { ...mockUser, lockedUntil: null };
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

  describe('role assignment', () => {
    const mockRoles = [
      {
        id: 'role-user',
        name: SYSTEM_ROLES.USER,
        description: null,
        isSystem: true,
        isSuper: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      },
      {
        id: 'role-admin',
        name: SYSTEM_ROLES.ADMIN,
        description: null,
        isSystem: true,
        isSuper: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      }
    ];

    beforeEach(() => {
      roleServiceMock.getAll.mockReturnValue(of(mockRoles));
      fixture.detectChanges();
    });

    it('should populate selectedRoleIds from user roles on load', () => {
      expect(component['selectedRoleIds']()).toEqual(['role-user']);
    });

    it('should update selectedRoleIds on onRolesChange', () => {
      component.onRolesChange(['role-admin']);
      expect(component['selectedRoleIds']()).toEqual(['role-admin']);
    });

    it('rolesChanged should be true when selection differs from initial', () => {
      component.onRolesChange(['role-admin']);
      expect(component['rolesChanged']()).toBe(true);
    });

    it('rolesChanged should be false when selection matches initial', () => {
      component.onRolesChange(['role-user']);
      expect(component['rolesChanged']()).toBe(false);
    });

    it('canSubmit should be true when only roles changed (form pristine)', () => {
      component.onRolesChange(['role-admin']);
      expect(component['canSubmit']()).toBe(true);
    });

    it('should call assignRoleToUser for newly added roles on submit', () => {
      component.onRolesChange(['role-user', 'role-admin']);
      component.onSubmit();

      expect(roleServiceMock.assignRoleToUser).toHaveBeenCalledWith(
        'user-1',
        'role-admin'
      );
    });

    it('should call removeRoleFromUser for removed roles on submit', () => {
      component.onRolesChange([]);
      component.onSubmit();

      expect(roleServiceMock.removeRoleFromUser).toHaveBeenCalledWith(
        'user-1',
        'role-user'
      );
    });

    it('should update initialRoleIds after successful role save', () => {
      component.onRolesChange(['role-admin']);
      component.onSubmit();

      expect(component['selectedRoleIds']()).toEqual(['role-admin']);
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
      expect(navigateSpy).toHaveBeenCalledWith(['/admin', 'users']);
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
