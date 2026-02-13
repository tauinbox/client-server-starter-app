import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ProfileComponent } from './profile.component';
import { AuthService } from '../../services/auth.service';
import type { User } from '@shared/models/user.types';

const mockUser: User = {
  id: '1',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  isActive: true,
  isAdmin: false,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01')
};

describe('ProfileComponent', () => {
  let component: ProfileComponent;
  let fixture: ComponentFixture<ProfileComponent>;
  let authServiceMock: {
    getProfile: ReturnType<typeof vi.fn>;
    updateProfile: ReturnType<typeof vi.fn>;
    getOAuthAccounts: ReturnType<typeof vi.fn>;
    unlinkOAuthAccount: ReturnType<typeof vi.fn>;
  };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    authServiceMock = {
      getProfile: vi.fn().mockReturnValue(of(mockUser)),
      updateProfile: vi.fn(),
      getOAuthAccounts: vi.fn().mockReturnValue(of([])),
      unlinkOAuthAccount: vi.fn()
    };

    snackBarMock = { open: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: AuthService, useValue: authServiceMock },
        { provide: MatSnackBar, useValue: snackBarMock }
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
    it('should load profile and patch form on init', () => {
      fixture.detectChanges();

      expect(authServiceMock.getProfile).toHaveBeenCalled();
      expect(component['user']()).toEqual(mockUser);
      expect(component['loading']()).toBe(false);
      expect(component['profileForm'].value).toEqual({
        firstName: 'Test',
        lastName: 'User',
        password: ''
      });
    });

    it('should mark form as pristine after loading', () => {
      fixture.detectChanges();
      expect(component['profileForm'].pristine).toBe(true);
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

  describe('onSubmit', () => {
    beforeEach(() => {
      fixture.detectChanges(); // Triggers ngOnInit → loadProfile
    });

    it('should not submit when form is invalid', () => {
      component['profileForm'].controls.firstName.setValue('');
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

      component['profileForm'].patchValue({ firstName: 'Updated' });
      component['profileForm'].markAsDirty();
      component.onSubmit();

      expect(authServiceMock.updateProfile).toHaveBeenCalledWith({
        firstName: 'Updated',
        lastName: 'User'
      });
    });

    it('should include password when provided', () => {
      const updatedUser = { ...mockUser, firstName: 'Updated' };
      authServiceMock.updateProfile.mockReturnValue(of(updatedUser));

      component['profileForm'].patchValue({
        firstName: 'Updated',
        password: 'newpassword123'
      });
      component['profileForm'].markAsDirty();
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

      component['profileForm'].patchValue({ firstName: 'Updated' });
      component.onSubmit();

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Profile updated successfully',
        'Close',
        { duration: 5000 }
      );
      expect(component['user']()).toEqual(updatedUser);
      expect(component['saving']()).toBe(false);
      expect(component['profileForm'].pristine).toBe(true);
    });

    it('should reset password field after successful update', () => {
      const updatedUser = { ...mockUser, firstName: 'Updated' };
      authServiceMock.updateProfile.mockReturnValue(of(updatedUser));

      component['profileForm'].patchValue({
        firstName: 'Updated',
        password: 'newpassword'
      });
      component.onSubmit();

      expect(component['profileForm'].controls.password.value).toBe('');
    });

    it('should set error on update failure', () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Update failed' },
        status: 400
      });
      authServiceMock.updateProfile.mockReturnValue(
        throwError(() => httpError)
      );

      component['profileForm'].patchValue({ firstName: 'Updated' });
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

      component['profileForm'].patchValue({ firstName: 'Updated' });
      component.onSubmit();

      expect(component['error']()).toBe(
        'Failed to update profile. Please try again.'
      );
    });
  });

  describe('togglePasswordVisibility', () => {
    it('should toggle showPassword signal', () => {
      fixture.detectChanges();
      expect(component['showPassword']()).toBe(false);
      component.togglePasswordVisibility();
      expect(component['showPassword']()).toBe(true);
    });
  });
});
