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

import { STEP_UP_OPERATION } from '@app/shared/constants';
import { ProfileComponent } from './profile.component';
import { AuthService } from '../../services/auth.service';
import { NotifyService } from '@core/services/notify.service';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
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
  hasPassword: true,
  mfaEnabled: false,
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
    initiateEmailChange: ReturnType<typeof vi.fn>;
    getOAuthAccounts: ReturnType<typeof vi.fn>;
    unlinkOAuthAccount: ReturnType<typeof vi.fn>;
    initOAuthLink: ReturnType<typeof vi.fn>;
    initOAuthReauth: ReturnType<typeof vi.fn>;
  };
  let notifyMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
  let adaptiveDialogMock: { openConfirm: ReturnType<typeof vi.fn> };
  let activatedRouteMock: { snapshot: { queryParamMap: Map<string, string> } };
  let featureFlagServiceMock: {
    getEvaluatedFlags: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authServiceMock = {
      getProfile: vi.fn().mockReturnValue(of(mockUser)),
      updateProfile: vi.fn(),
      initiateEmailChange: vi.fn(),
      getOAuthAccounts: vi.fn().mockReturnValue(of([])),
      unlinkOAuthAccount: vi.fn(),
      initOAuthLink: vi.fn().mockReturnValue(of({ message: 'Link initiated' })),
      initOAuthReauth: vi
        .fn()
        .mockReturnValue(of({ message: 'Re-authentication initiated' }))
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

    adaptiveDialogMock = { openConfirm: vi.fn().mockReturnValue(of(true)) };

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
        { provide: AdaptiveDialogService, useValue: adaptiveDialogMock },
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

  it('marks each password field for password managers by its role', async () => {
    fixture.detectChanges();
    component.profileModel.set({
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      currentPassword: '',
      password: 'NewPassword123',
      confirmPassword: 'NewPassword123'
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const values = Array.from(
      fixture.nativeElement.querySelectorAll('input[type="password"]')
    ).map((input) => (input as HTMLInputElement).getAttribute('autocomplete'));

    expect(values).toEqual([
      'new-password',
      'current-password',
      'new-password'
    ]);
  });

  describe('oauth_error query parameter', () => {
    it('reports a cancelled link attempt as a notice, not a failure', () => {
      activatedRouteMock.snapshot.queryParamMap.set(
        'oauth_error',
        'oauth_cancelled'
      );
      fixture.detectChanges();

      expect(notifyMock.info).toHaveBeenCalledWith(
        'auth.profile.linkCancelled'
      );
      expect(notifyMock.error).not.toHaveBeenCalled();
    });

    it('still reports a genuine link failure as an error', () => {
      activatedRouteMock.snapshot.queryParamMap.set(
        'oauth_error',
        'link_failed'
      );
      fixture.detectChanges();

      expect(notifyMock.error).toHaveBeenCalledWith(
        'auth.profile.errorLinkFailed'
      );
      expect(notifyMock.info).not.toHaveBeenCalled();
    });
  });

  describe('oauth_linked query parameter', () => {
    it('announces a known provider by its translated label', () => {
      activatedRouteMock.snapshot.queryParamMap.set('oauth_linked', 'google');
      fixture.detectChanges();

      expect(notifyMock.success).toHaveBeenCalledWith(
        'auth.profile.oauthConnected',
        { provider: 'Google' }
      );
    });

    it('stays silent for a forged provider value', () => {
      activatedRouteMock.snapshot.queryParamMap.set(
        'oauth_linked',
        'constructor'
      );
      fixture.detectChanges();

      expect(notifyMock.success).not.toHaveBeenCalled();
    });
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

    it('accepts a password made only of lower-case letters', async () => {
      component.profileModel.set({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        currentPassword: 'CurrentPass1',
        password: 'passwordonly',
        confirmPassword: 'passwordonly'
      });
      await fixture.whenStable();

      expect(component.profileForm.password().errors()).toEqual([]);
      expect(component.profileForm.password().valid()).toBe(true);
    });

    it('rejects a password longer than the server ceiling', async () => {
      const tooLong = `Aa1${'x'.repeat(126)}`;
      component.profileModel.set({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        currentPassword: 'CurrentPass1',
        password: tooLong,
        confirmPassword: tooLong
      });
      await fixture.whenStable();

      const errors = component.profileForm.password().errors();
      expect(errors.some((e) => e.kind === 'maxLength')).toBe(true);
      expect(errors.find((e) => e.kind === 'maxLength')?.message).toBe(
        'auth.profile.passwordMaxLength'
      );
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
        password: 'NewPassword123',
        confirmPassword: 'Different123'
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
        password: 'NewPassword123',
        confirmPassword: 'NewPassword123'
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
        password: 'NewPassword123',
        confirmPassword: 'NewPassword123'
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

  describe('a first password on an account created through a provider', () => {
    const oauthOnlyUser = { ...mockUser, hasPassword: false };

    function typePassword(): void {
      component.profileModel.set({
        email: mockUser.email,
        firstName: mockUser.firstName,
        lastName: mockUser.lastName,
        currentPassword: '',
        password: 'Sunrise-Kettle-19',
        confirmPassword: 'Sunrise-Kettle-19'
      });
    }

    beforeEach(() => {
      authServiceMock.getProfile.mockReturnValue(of(oauthOnlyUser));
      authServiceMock.getOAuthAccounts.mockReturnValue(
        of([{ provider: 'google', createdAt: '2025-01-01T00:00:00.000Z' }])
      );
    });

    it('starts a provider round trip bound to the password instead of saving', async () => {
      fixture.detectChanges();
      typePassword();
      await fixture.whenStable();

      component.onSubmit();

      expect(authServiceMock.initOAuthReauth).toHaveBeenCalledWith(
        STEP_UP_OPERATION.PASSWORD_SET
      );
      // The password must never reach the server without the proof.
      expect(authServiceMock.updateProfile).not.toHaveBeenCalledWith(
        expect.objectContaining({ password: 'Sunrise-Kettle-19' })
      );
    });

    it('never puts the password in session storage', async () => {
      fixture.detectChanges();
      typePassword();
      await fixture.whenStable();

      component.onSubmit();

      const stored = sessionStorage.getItem('pending_password_set');
      expect(stored).not.toBeNull();
      expect(stored).not.toContain('Sunrise-Kettle-19');
    });

    it('asks for the password again on the load that follows the round trip', async () => {
      sessionStorage.setItem('pending_password_set', 'true');
      activatedRouteMock.snapshot.queryParamMap.set('reauth', 'ok');

      fixture.detectChanges();
      await fixture.whenStable();

      expect(notifyMock.info).toHaveBeenCalledWith(
        'auth.profile.reauthDonePassword'
      );
      expect(authServiceMock.initiateEmailChange).not.toHaveBeenCalled();
    });

    it('sends the password once the round trip is done', async () => {
      sessionStorage.setItem('pending_password_set', 'true');
      activatedRouteMock.snapshot.queryParamMap.set('reauth', 'ok');
      authServiceMock.updateProfile.mockReturnValue(of(oauthOnlyUser));

      fixture.detectChanges();
      typePassword();
      await fixture.whenStable();

      component.onSubmit();

      expect(authServiceMock.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'Sunrise-Kettle-19' })
      );
    });

    it('does not accept a round trip that was taken for the email change', async () => {
      // That proof is bound to `email_change`, so a password submit behind it
      // would be refused by the server. The form must start its own trip.
      sessionStorage.setItem('pending_email_change', 'new@example.com');
      activatedRouteMock.snapshot.queryParamMap.set('reauth', 'ok');
      authServiceMock.initiateEmailChange.mockReturnValue(
        of({ message: 'ok' })
      );

      fixture.detectChanges();
      typePassword();
      await fixture.whenStable();

      component.onSubmit();

      expect(authServiceMock.initOAuthReauth).toHaveBeenCalledWith(
        STEP_UP_OPERATION.PASSWORD_SET
      );
      expect(authServiceMock.updateProfile).not.toHaveBeenCalledWith(
        expect.objectContaining({ password: 'Sunrise-Kettle-19' })
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
        password: 'NewPassword123',
        confirmPassword: 'NewPassword123'
      });
      await fixture.whenStable();
      component.onSubmit();

      expect(authServiceMock.updateProfile).toHaveBeenCalledWith({
        firstName: 'Updated',
        lastName: 'User',
        password: 'NewPassword123',
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
        password: 'NewPassword1',
        confirmPassword: 'NewPassword1'
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

  describe('email comparison ignores the stored address casing', () => {
    beforeEach(() => {
      authServiceMock.getProfile.mockReturnValue(
        of({ ...mockUser, email: 'User@Example.com' })
      );
      fixture.detectChanges();
    });

    it('does not ask for the current password when nothing was edited', async () => {
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component['requiresCurrentPassword']()).toBe(false);
      expect(
        fixture.nativeElement.querySelector(
          'input[autocomplete="current-password"]'
        )
      ).toBeNull();
    });

    it('saves personal fields directly instead of starting an email change', async () => {
      authServiceMock.updateProfile.mockReturnValue(
        of({ ...mockUser, email: 'User@Example.com', firstName: 'Updated' })
      );

      component.profileModel.set({
        email: 'User@Example.com',
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
  });

  describe('disconnectProvider', () => {
    it('ignores a provider name it does not know', () => {
      fixture.detectChanges();

      component.disconnectProvider('unknown-provider');

      expect(authServiceMock.unlinkOAuthAccount).not.toHaveBeenCalled();
      expect(component['oauthLoading']()).toBe(false);
    });

    it('unlinks a known provider', () => {
      authServiceMock.unlinkOAuthAccount.mockReturnValue(
        of({ message: 'Unlinked' })
      );
      fixture.detectChanges();

      component.disconnectProvider('google');

      expect(authServiceMock.unlinkOAuthAccount).toHaveBeenCalledWith('google');
    });
  });

  describe('submitting an email change alongside other edits', () => {
    const renamedUser: UserResponse = {
      ...mockUser,
      firstName: 'Renamed',
      lastName: 'Person'
    };

    beforeEach(() => {
      authServiceMock.initiateEmailChange.mockReturnValue(
        of({ message: 'Confirmation link sent' })
      );
      authServiceMock.updateProfile.mockReturnValue(of(renamedUser));
      fixture.detectChanges();
    });

    function saveButton(): HTMLButtonElement {
      return fixture.nativeElement.querySelector(
        'form button[type="submit"]'
      ) as HTMLButtonElement;
    }

    /** Real typing, so the field is marked dirty the way a user marks it. */
    async function typeInto(selector: string, value: string): Promise<void> {
      const input = fixture.nativeElement.querySelector(
        selector
      ) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('persists the name typed alongside the new email', async () => {
      component.profileModel.set({
        email: 'new@example.com',
        firstName: 'Renamed',
        lastName: 'Person',
        currentPassword: 'Password1',
        password: '',
        confirmPassword: ''
      });
      await fixture.whenStable();

      component.onSubmit();
      await fixture.whenStable();

      expect(authServiceMock.initiateEmailChange).toHaveBeenCalledWith(
        'new@example.com',
        'Password1'
      );
      expect(authServiceMock.updateProfile).toHaveBeenCalledWith({
        firstName: 'Renamed',
        lastName: 'Person'
      });
      expect(notifyMock.success).toHaveBeenCalledWith(
        'auth.profile.emailChangeInitiatedWithProfile'
      );
    });

    it('leaves the persisted name on screen and the email unchanged', async () => {
      component.profileModel.set({
        email: 'new@example.com',
        firstName: 'Renamed',
        lastName: 'Person',
        currentPassword: 'Password1',
        password: '',
        confirmPassword: ''
      });
      await fixture.whenStable();

      component.onSubmit();
      await fixture.whenStable();

      // Nothing may be left on screen that only looks saved: the fields must
      // match the record the server returned.
      expect(component['user']()?.firstName).toBe('Renamed');
      expect(component.profileModel().firstName).toBe(
        component['user']()?.firstName
      );
      expect(component.profileModel().lastName).toBe(
        component['user']()?.lastName
      );
      // The address only changes once the link in the new inbox is clicked.
      expect(component.profileModel().email).toBe('test@example.com');
    });

    it('sends the password change too, and initiates the email first', async () => {
      component.profileModel.set({
        email: 'new@example.com',
        firstName: 'Test',
        lastName: 'User',
        currentPassword: 'Password1',
        password: 'NewPassword123',
        confirmPassword: 'NewPassword123'
      });
      await fixture.whenStable();

      component.onSubmit();
      await fixture.whenStable();

      expect(authServiceMock.updateProfile).toHaveBeenCalledWith({
        firstName: 'Test',
        lastName: 'User',
        password: 'NewPassword123',
        currentPassword: 'Password1'
      });
      // The update rehashes the current password and revokes the session, so an
      // initiate that ran after it would be rejected.
      expect(
        authServiceMock.initiateEmailChange.mock.invocationCallOrder[0]
      ).toBeLessThan(authServiceMock.updateProfile.mock.invocationCallOrder[0]);
    });

    it('sends no profile update when only the email changed', async () => {
      component.profileModel.set({
        email: 'new@example.com',
        firstName: 'Test',
        lastName: 'User',
        currentPassword: 'Password1',
        password: '',
        confirmPassword: ''
      });
      await fixture.whenStable();

      component.onSubmit();
      await fixture.whenStable();

      expect(authServiceMock.updateProfile).not.toHaveBeenCalled();
      expect(notifyMock.success).toHaveBeenCalledWith(
        'auth.profile.emailChangeInitiated'
      );
    });

    it('does not touch the profile when the email initiation fails', async () => {
      authServiceMock.initiateEmailChange.mockReturnValue(
        throwError(() => new HttpErrorResponse({ error: null, status: 400 }))
      );

      component.profileModel.set({
        email: 'new@example.com',
        firstName: 'Renamed',
        lastName: 'Person',
        currentPassword: 'WrongPassword',
        password: '',
        confirmPassword: ''
      });
      await fixture.whenStable();

      component.onSubmit();
      await fixture.whenStable();

      expect(authServiceMock.updateProfile).not.toHaveBeenCalled();
      expect(component['error']()).toBe(
        'Failed to initiate email change. Please try again.'
      );
    });

    it('sends nothing and keeps Save available when the dialog is cancelled', async () => {
      adaptiveDialogMock.openConfirm.mockReturnValue(of(false));

      await typeInto('input[autocomplete="given-name"]', 'Renamed');
      await typeInto('input[autocomplete="email"]', 'new@example.com');
      await typeInto('input[autocomplete="current-password"]', 'Password1');

      component.onSubmit();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(authServiceMock.initiateEmailChange).not.toHaveBeenCalled();
      expect(authServiceMock.updateProfile).not.toHaveBeenCalled();
      expect(component.profileForm().dirty()).toBe(true);
      expect(saveButton().disabled).toBe(false);
    });
  });
});
