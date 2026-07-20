import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute } from '@angular/router';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

import { ProfileComponent } from './profile.component';
import { AuthService } from '../../services/auth.service';
import { NotifyService } from '@core/services/notify.service';
import type {
  EvaluatedFeatureFlagsResponse,
  RoleResponse,
  UserResponse
} from '@app/shared/types';
import { FeatureFlagsStore } from '@features/feature-flags/store/feature-flags.store';
import { FeatureFlagService } from '@features/feature-flags/services/feature-flag.service';

const mockUserRole: RoleResponse = {
  id: 'role-user',
  name: 'user',
  description: 'Regular user',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

const mockUser: UserResponse = {
  id: '1',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  isActive: true,
  roles: [mockUserRole],
  isEmailVerified: true,
  locale: 'en',
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
  let notifyMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
  let activatedRouteMock: { snapshot: { queryParamMap: Map<string, string> } };
  let featureFlagServiceMock: {
    getEvaluatedFlags: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authServiceMock = {
      getProfile: vi.fn().mockReturnValue(of(mockUser)),
      updateProfile: vi.fn(),
      getOAuthAccounts: vi.fn().mockReturnValue(of([])),
      unlinkOAuthAccount: vi.fn(),
      initOAuthLink: vi.fn().mockReturnValue(of({ message: 'Link initiated' }))
    };
    featureFlagServiceMock = {
      getEvaluatedFlags: vi
        .fn()
        .mockReturnValue(
          of<EvaluatedFeatureFlagsResponse>({ flags: {}, evaluatedAt: '' })
        )
    };

    notifyMock = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    };

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
        { provide: NotifyService, useValue: notifyMock },
        { provide: FeatureFlagService, useValue: featureFlagServiceMock },
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
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        currentPassword: '',
        password: '',
        confirmPassword: ''
      });
    });

    it('should reset form dirty state after loading', () => {
      fixture.detectChanges();
      expect(component.profileForm().dirty()).toBe(false);
    });

    it('should show the translated server error on profile load failure', () => {
      const httpError = new HttpErrorResponse({
        error: { errorKey: 'errors.users.notFound', message: 'Unauthorized' },
        status: 401
      });
      authServiceMock.getProfile.mockReturnValue(throwError(() => httpError));

      fixture.detectChanges();

      expect(component['loading']()).toBe(false);
      expect(component['error']()).toBe('User not found');
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

    it('should require firstName', async () => {
      component.profileModel.set({
        email: 'test@example.com',
        firstName: '',
        lastName: 'User',
        currentPassword: '',
        password: '',
        confirmPassword: ''
      });
      await fixture.whenStable();
      const errors = component.profileForm.firstName().errors();
      expect(errors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should require lastName', async () => {
      component.profileModel.set({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: '',
        currentPassword: '',
        password: '',
        confirmPassword: ''
      });
      await fixture.whenStable();
      const errors = component.profileForm.lastName().errors();
      expect(errors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should validate password minLength when provided', async () => {
      component.profileModel.set({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        currentPassword: 'CurrentPass1',
        password: 'short',
        confirmPassword: ''
      });
      await fixture.whenStable();
      const errors = component.profileForm.password().errors();
      expect(errors.some((e) => e.kind === 'minLength')).toBe(true);
    });

    it('should allow empty password (optional)', async () => {
      component.profileModel.set({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        currentPassword: '',
        password: '',
        confirmPassword: ''
      });
      await fixture.whenStable();
      expect(component.profileForm().valid()).toBe(true);
    });

    it('should have passwordMismatch when passwords differ', async () => {
      component.profileModel.set({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        currentPassword: 'CurrentPass1',
        password: 'newpassword123',
        confirmPassword: 'different123'
      });
      await fixture.whenStable();
      const errors = component.profileForm.confirmPassword().errors();
      expect(errors.some((e) => e.kind === 'passwordMismatch')).toBe(true);
    });

    it('should be valid when passwords match and current password is provided', async () => {
      component.profileModel.set({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        currentPassword: 'CurrentPass1',
        password: 'newpassword123',
        confirmPassword: 'newpassword123'
      });
      await fixture.whenStable();
      expect(component.profileForm().valid()).toBe(true);
    });

    it('should require currentPassword when new password is entered', async () => {
      component.profileModel.set({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        currentPassword: '',
        password: 'newpassword123',
        confirmPassword: 'newpassword123'
      });
      await fixture.whenStable();
      const errors = component.profileForm.currentPassword().errors();
      expect(errors.some((e) => e.kind === 'currentPasswordRequired')).toBe(
        true
      );
      expect(component.profileForm().valid()).toBe(false);
    });

    it('should NOT require currentPassword when password is blank', async () => {
      component.profileModel.set({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        currentPassword: '',
        password: '',
        confirmPassword: ''
      });
      await fixture.whenStable();
      const errors = component.profileForm.currentPassword().errors();
      expect(errors.some((e) => e.kind === 'currentPasswordRequired')).toBe(
        false
      );
    });
  });

  describe('onSubmit', () => {
    beforeEach(() => {
      fixture.detectChanges(); // Triggers ngOnInit → loadProfile
    });

    it('should not submit when form is invalid', async () => {
      component.profileModel.set({
        email: 'test@example.com',
        firstName: '',
        lastName: 'User',
        currentPassword: '',
        password: '',
        confirmPassword: ''
      });
      await fixture.whenStable();
      component.onSubmit();
      expect(authServiceMock.updateProfile).not.toHaveBeenCalled();
    });

    it('should not submit when user is null', () => {
      component['user'].set(null);
      component.onSubmit();
      expect(authServiceMock.updateProfile).not.toHaveBeenCalled();
    });

    it('should submit without password when password is empty', async () => {
      const updatedUser = { ...mockUser, firstName: 'Updated' };
      authServiceMock.updateProfile.mockReturnValue(of(updatedUser));

      component.profileModel.set({
        email: 'test@example.com',
        firstName: 'Updated',
        lastName: 'User',
        currentPassword: '',
        password: '',
        confirmPassword: ''
      });
      await fixture.whenStable();
      component.onSubmit();

      expect(authServiceMock.updateProfile).toHaveBeenCalledWith({
        firstName: 'Updated',
        lastName: 'User'
      });
    });

    it('should include password and currentPassword when password is provided', async () => {
      const updatedUser = { ...mockUser, firstName: 'Updated' };
      authServiceMock.updateProfile.mockReturnValue(of(updatedUser));

      component.profileModel.set({
        email: 'test@example.com',
        firstName: 'Updated',
        lastName: 'User',
        currentPassword: 'CurrentPass1',
        password: 'newpassword123',
        confirmPassword: 'newpassword123'
      });
      await fixture.whenStable();
      component.onSubmit();

      expect(authServiceMock.updateProfile).toHaveBeenCalledWith({
        firstName: 'Updated',
        lastName: 'User',
        password: 'newpassword123',
        currentPassword: 'CurrentPass1'
      });
    });

    it('should show snackbar and update user on success', async () => {
      const updatedUser = { ...mockUser, firstName: 'Updated' };
      authServiceMock.updateProfile.mockReturnValue(of(updatedUser));

      component.profileModel.set({
        email: 'test@example.com',
        firstName: 'Updated',
        lastName: 'User',
        currentPassword: '',
        password: '',
        confirmPassword: ''
      });
      await fixture.whenStable();
      component.onSubmit();

      expect(notifyMock.success).toHaveBeenCalledWith(
        'auth.profile.successUpdated'
      );
      expect(component['user']()).toEqual(updatedUser);
      expect(component['saving']()).toBe(false);
    });

    it('should reset password and currentPassword fields after successful update', async () => {
      const updatedUser = { ...mockUser, firstName: 'Updated' };
      authServiceMock.updateProfile.mockReturnValue(of(updatedUser));

      component.profileModel.set({
        email: 'test@example.com',
        firstName: 'Updated',
        lastName: 'User',
        currentPassword: 'CurrentPass1',
        password: 'newpassword',
        confirmPassword: 'newpassword'
      });
      await fixture.whenStable();
      component.onSubmit();

      expect(component.profileModel().password).toBe('');
      expect(component.profileModel().confirmPassword).toBe('');
      expect(component.profileModel().currentPassword).toBe('');
    });

    it('should set error on update failure', async () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Update failed' },
        status: 400
      });
      authServiceMock.updateProfile.mockReturnValue(
        throwError(() => httpError)
      );

      component.profileModel.set({
        email: 'test@example.com',
        firstName: 'Updated',
        lastName: 'User',
        currentPassword: '',
        password: '',
        confirmPassword: ''
      });
      await fixture.whenStable();
      component.onSubmit();

      expect(component['error']()).toBe(
        'Failed to update profile. Please try again.'
      );
      expect(component['saving']()).toBe(false);
    });

    it('should show fallback error on update failure without message', async () => {
      const httpError = new HttpErrorResponse({
        error: null,
        status: 500
      });
      authServiceMock.updateProfile.mockReturnValue(
        throwError(() => httpError)
      );

      component.profileModel.set({
        email: 'test@example.com',
        firstName: 'Updated',
        lastName: 'User',
        currentPassword: '',
        password: '',
        confirmPassword: ''
      });
      await fixture.whenStable();
      component.onSubmit();

      expect(component['error']()).toBe(
        'Failed to update profile. Please try again.'
      );
    });
  });

  describe('OAuth connected-accounts visibility', () => {
    async function loadFlags(flags: Record<string, boolean>): Promise<void> {
      featureFlagServiceMock.getEvaluatedFlags.mockReturnValue(
        of<EvaluatedFeatureFlagsResponse>({ flags, evaluatedAt: '' })
      );
      await TestBed.inject(FeatureFlagsStore).load();
      fixture.detectChanges();
      await fixture.whenStable();
    }

    function providerRowCount(): number {
      return fixture.nativeElement.querySelectorAll('.oauth-provider-row')
        .length;
    }

    it('hides the card when no provider is configured and none are linked', () => {
      fixture.detectChanges();
      expect(providerRowCount()).toBe(0);
      expect(component['visibleProviders']()).toEqual([]);
    });

    it('shows a row per provider when all flags are enabled', async () => {
      fixture.detectChanges();
      await loadFlags({
        'oauth-google': true,
        'oauth-facebook': true,
        'oauth-vk': true
      });
      expect(providerRowCount()).toBe(3);
    });

    it('shows only the configured subset of providers', async () => {
      fixture.detectChanges();
      await loadFlags({ 'oauth-google': true, 'oauth-facebook': true });
      expect(component['visibleProviders']()).toEqual(['google', 'facebook']);
      expect(providerRowCount()).toBe(2);
    });

    it('keeps a linked provider visible even when its flag is off', async () => {
      authServiceMock.getOAuthAccounts.mockReturnValue(
        of([{ provider: 'vk', createdAt: '2025-01-01T00:00:00.000Z' }])
      );
      fixture.detectChanges();
      await loadFlags({ 'oauth-google': true });
      expect(component['visibleProviders']()).toEqual(['google', 'vk']);
      expect(providerRowCount()).toBe(2);
    });
  });
});
