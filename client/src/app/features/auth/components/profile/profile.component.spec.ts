import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute } from '@angular/router';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

import { ProfileComponent } from './profile.component';
import { AuthService } from '../../services/auth.service';
import type { User } from '@shared/models/user.types';
import type { RoleResponse } from '@app/shared/types';

const mockUserRole: RoleResponse = {
  id: 'role-user',
  name: 'user',
  description: 'Regular user',
  isSystem: true,
  isSuper: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

const mockUser: User = {
  id: '1',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  isActive: true,
  roles: [mockUserRole],
  isEmailVerified: true,
  lockedUntil: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  deletedAt: null
};

describe('ProfileComponent', () => {
  let component: ProfileComponent;
  let fixture: ComponentFixture<ProfileComponent>;
  let authServiceMock: {
    getProfile: ReturnType<typeof vi.fn>;
    updateProfile: ReturnType<typeof vi.fn>;
    getOAuthAccounts: ReturnType<typeof vi.fn>;
    unlinkOAuthAccount: ReturnType<typeof vi.fn>;
    initOAuthLink: ReturnType<typeof vi.fn>;
  };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };
  let activatedRouteMock: { snapshot: { queryParamMap: Map<string, string> } };

  beforeEach(async () => {
    authServiceMock = {
      getProfile: vi.fn().mockReturnValue(of(mockUser)),
      updateProfile: vi.fn(),
      getOAuthAccounts: vi.fn().mockReturnValue(of([])),
      unlinkOAuthAccount: vi.fn(),
      initOAuthLink: vi.fn().mockReturnValue(of({ message: 'Link initiated' }))
    };

    snackBarMock = { open: vi.fn() };

    activatedRouteMock = {
      snapshot: {
        queryParamMap: new Map()
      }
    };

    await TestBed.configureTestingModule({
      imports: [ProfileComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: AuthService, useValue: authServiceMock },
        { provide: MatSnackBar, useValue: snackBarMock },
        { provide: ActivatedRoute, useValue: activatedRouteMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('ngOnInit / loadProfile', () => {
    it('should load profile and set model on init', () => {
      fixture.detectChanges();

      expect(authServiceMock.getProfile).toHaveBeenCalled();
      expect(component['user']()).toEqual(mockUser);
      expect(component['loading']()).toBe(false);
      expect(component.profileModel()).toEqual({
        firstName: 'Test',
        lastName: 'User',
        password: '',
        confirmPassword: ''
      });
    });

    it('should reset form dirty state after loading', () => {
      fixture.detectChanges();
      expect(component.profileForm().dirty()).toBe(false);
    });

    it('should set error on profile load failure', () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Unauthorized' },
        status: 401
      });
      authServiceMock.getProfile.mockReturnValue(throwError(() => httpError));

      fixture.detectChanges();

      expect(component['loading']()).toBe(false);
      expect(component['error']()).toBe('Unauthorized');
    });

    it('should show fallback error message when no server message', () => {
      const httpError = new HttpErrorResponse({
        error: null,
        status: 500
      });
      authServiceMock.getProfile.mockReturnValue(throwError(() => httpError));

      fixture.detectChanges();

      expect(component['error']()).toBe(
        'Failed to load profile. Please try again.'
      );
    });
  });

  describe('form validation', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should require firstName', () => {
      component.profileModel.set({
        firstName: '',
        lastName: 'User',
        password: '',
        confirmPassword: ''
      });
      TestBed.tick();
      const errors = component.profileForm.firstName().errors();
      expect(errors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should require lastName', () => {
      component.profileModel.set({
        firstName: 'Test',
        lastName: '',
        password: '',
        confirmPassword: ''
      });
      TestBed.tick();
      const errors = component.profileForm.lastName().errors();
      expect(errors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should validate password minLength when provided', () => {
      component.profileModel.set({
        firstName: 'Test',
        lastName: 'User',
        password: 'short',
        confirmPassword: ''
      });
      TestBed.tick();
      const errors = component.profileForm.password().errors();
      expect(errors.some((e) => e.kind === 'minLength')).toBe(true);
    });

    it('should allow empty password (optional)', () => {
      component.profileModel.set({
        firstName: 'Test',
        lastName: 'User',
        password: '',
        confirmPassword: ''
      });
      TestBed.tick();
      expect(component.profileForm().valid()).toBe(true);
    });

    it('should have passwordMismatch when passwords differ', () => {
      component.profileModel.set({
        firstName: 'Test',
        lastName: 'User',
        password: 'newpassword123',
        confirmPassword: 'different123'
      });
      TestBed.tick();
      const errors = component.profileForm.confirmPassword().errors();
      expect(errors.some((e) => e.kind === 'passwordMismatch')).toBe(true);
    });

    it('should be valid when passwords match', () => {
      component.profileModel.set({
        firstName: 'Test',
        lastName: 'User',
        password: 'newpassword123',
        confirmPassword: 'newpassword123'
      });
      TestBed.tick();
      expect(component.profileForm().valid()).toBe(true);
    });
  });

  describe('onSubmit', () => {
    beforeEach(() => {
      fixture.detectChanges(); // Triggers ngOnInit → loadProfile
    });

    it('should not submit when form is invalid', () => {
      component.profileModel.set({
        firstName: '',
        lastName: 'User',
        password: '',
        confirmPassword: ''
      });
      TestBed.tick();
      component.onSubmit();
      expect(authServiceMock.updateProfile).not.toHaveBeenCalled();
    });

    it('should not submit when user is null', () => {
      component['user'].set(null);
      component.onSubmit();
      expect(authServiceMock.updateProfile).not.toHaveBeenCalled();
    });

    it('should submit without password when password is empty', () => {
      const updatedUser = { ...mockUser, firstName: 'Updated' };
      authServiceMock.updateProfile.mockReturnValue(of(updatedUser));

      component.profileModel.set({
        firstName: 'Updated',
        lastName: 'User',
        password: '',
        confirmPassword: ''
      });
      TestBed.tick();
      component.onSubmit();

      expect(authServiceMock.updateProfile).toHaveBeenCalledWith({
        firstName: 'Updated',
        lastName: 'User'
      });
    });

    it('should include password when provided', () => {
      const updatedUser = { ...mockUser, firstName: 'Updated' };
      authServiceMock.updateProfile.mockReturnValue(of(updatedUser));

      component.profileModel.set({
        firstName: 'Updated',
        lastName: 'User',
        password: 'newpassword123',
        confirmPassword: 'newpassword123'
      });
      TestBed.tick();
      component.onSubmit();

      expect(authServiceMock.updateProfile).toHaveBeenCalledWith({
        firstName: 'Updated',
        lastName: 'User',
        password: 'newpassword123'
      });
    });

    it('should show snackbar and update user on success', () => {
      const updatedUser = { ...mockUser, firstName: 'Updated' };
      authServiceMock.updateProfile.mockReturnValue(of(updatedUser));

      component.profileModel.set({
        firstName: 'Updated',
        lastName: 'User',
        password: '',
        confirmPassword: ''
      });
      TestBed.tick();
      component.onSubmit();

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Profile updated successfully',
        'Close',
        { duration: 5000 }
      );
      expect(component['user']()).toEqual(updatedUser);
      expect(component['saving']()).toBe(false);
    });

    it('should reset password fields after successful update', () => {
      const updatedUser = { ...mockUser, firstName: 'Updated' };
      authServiceMock.updateProfile.mockReturnValue(of(updatedUser));

      component.profileModel.set({
        firstName: 'Updated',
        lastName: 'User',
        password: 'newpassword',
        confirmPassword: 'newpassword'
      });
      TestBed.tick();
      component.onSubmit();

      expect(component.profileModel().password).toBe('');
      expect(component.profileModel().confirmPassword).toBe('');
    });

    it('should set error on update failure', () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Update failed' },
        status: 400
      });
      authServiceMock.updateProfile.mockReturnValue(
        throwError(() => httpError)
      );

      component.profileModel.set({
        firstName: 'Updated',
        lastName: 'User',
        password: '',
        confirmPassword: ''
      });
      TestBed.tick();
      component.onSubmit();

      expect(component['error']()).toBe('Update failed');
      expect(component['saving']()).toBe(false);
    });

    it('should show fallback error on update failure without message', () => {
      const httpError = new HttpErrorResponse({
        error: null,
        status: 500
      });
      authServiceMock.updateProfile.mockReturnValue(
        throwError(() => httpError)
      );

      component.profileModel.set({
        firstName: 'Updated',
        lastName: 'User',
        password: '',
        confirmPassword: ''
      });
      TestBed.tick();
      component.onSubmit();

      expect(component['error']()).toBe(
        'Failed to update profile. Please try again.'
      );
    });
  });
});
