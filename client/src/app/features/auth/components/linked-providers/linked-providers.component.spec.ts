import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopMaterialAnimations } from '../../../../../test-utils/material-animations';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { STEP_UP_OPERATION } from '@app/shared/constants';
import type { EvaluatedFeatureFlagsResponse } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { NotifyService } from '@core/services/notify.service';
import { FeatureFlagsStore } from '@features/feature-flags/store/feature-flags.store';
import { FeatureFlagService } from '@features/feature-flags/services/feature-flag.service';
import { AuthService } from '../../services/auth.service';
import {
  LinkedProvidersComponent,
  type ProviderChange
} from './linked-providers.component';

const GOOGLE_ACCOUNT = {
  provider: 'google',
  createdAt: '2025-01-01T00:00:00.000Z'
};

describe('LinkedProvidersComponent', () => {
  let component: LinkedProvidersComponent;
  let fixture: ComponentFixture<LinkedProvidersComponent>;
  let authServiceMock: {
    initOAuthLink: ReturnType<typeof vi.fn>;
    unlinkOAuthAccount: ReturnType<typeof vi.fn>;
  };
  let notifyMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let featureFlagServiceMock: { getEvaluatedFlags: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    authServiceMock = {
      initOAuthLink: vi.fn().mockReturnValue(of({ message: 'Link initiated' })),
      unlinkOAuthAccount: vi.fn().mockReturnValue(of({ message: 'Unlinked' }))
    };
    notifyMock = { success: vi.fn(), error: vi.fn() };
    featureFlagServiceMock = {
      getEvaluatedFlags: vi
        .fn()
        .mockReturnValue(
          of<EvaluatedFeatureFlagsResponse>({ flags: {}, evaluatedAt: '' })
        )
    };

    await TestBed.configureTestingModule({
      imports: [LinkedProvidersComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        provideNoopMaterialAnimations(),
        { provide: AuthService, useValue: authServiceMock },
        { provide: NotifyService, useValue: notifyMock },
        { provide: FeatureFlagService, useValue: featureFlagServiceMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LinkedProvidersComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('accounts', [GOOGLE_ACCOUNT]);
    fixture.detectChanges();
  });

  async function loadFlags(flags: Record<string, boolean>): Promise<void> {
    featureFlagServiceMock.getEvaluatedFlags.mockReturnValue(
      of<EvaluatedFeatureFlagsResponse>({ flags, evaluatedAt: '' })
    );
    await TestBed.inject(FeatureFlagsStore).load();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function providerRowCount(): number {
    return fixture.nativeElement.querySelectorAll('.oauth-provider-row').length;
  }

  function emitted(): ProviderChange[] {
    const changes: ProviderChange[] = [];
    component.reauthRequested.subscribe((change) => changes.push(change));
    return changes;
  }

  describe('visibility', () => {
    it('renders no card when no provider is configured and none are linked', async () => {
      fixture.componentRef.setInput('accounts', []);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.nativeElement.querySelector('mat-card')).toBeNull();
      expect(component['visibleProviders']()).toEqual([]);
    });

    it('shows a row per provider when all flags are enabled', async () => {
      await loadFlags({
        'oauth-google': true,
        'oauth-facebook': true,
        'oauth-vk': true
      });
      expect(providerRowCount()).toBe(3);
    });

    it('shows only the configured subset of providers', async () => {
      fixture.componentRef.setInput('accounts', []);
      await loadFlags({ 'oauth-google': true, 'oauth-facebook': true });
      expect(component['visibleProviders']()).toEqual(['google', 'facebook']);
      expect(providerRowCount()).toBe(2);
    });

    it('keeps a linked provider visible even when its flag is off', async () => {
      fixture.componentRef.setInput('accounts', [
        { provider: 'vk', createdAt: '2025-01-01T00:00:00.000Z' }
      ]);
      await loadFlags({ 'oauth-google': true });
      expect(component['visibleProviders']()).toEqual(['google', 'vk']);
      expect(providerRowCount()).toBe(2);
    });
  });

  // A linked provider signs the account in and no recovery path removes it, so
  // a stolen session must not be able to plant one.
  describe('connectProvider', () => {
    it('ignores a provider name it does not know', () => {
      const changes = emitted();

      component.connectProvider('unknown-provider');

      expect(authServiceMock.initOAuthLink).not.toHaveBeenCalled();
      expect(component['stepUpPrompt']()).toBeNull();
      expect(changes).toEqual([]);
    });

    it('asks an account that holds a password for it, and mints nothing yet', () => {
      component.connectProvider('facebook');

      expect(component['stepUpPrompt']()).toEqual({
        provider: 'facebook',
        mode: 'link'
      });
      expect(authServiceMock.initOAuthLink).not.toHaveBeenCalled();
    });

    it('sends the password with the link request', async () => {
      component.connectProvider('facebook');
      component.stepUpPasswordModel.set({ currentPassword: 'Password1' });
      await fixture.whenStable();
      component['confirmStepUp']();

      expect(authServiceMock.initOAuthLink).toHaveBeenCalledWith('Password1');
      expect(component['stepUpPrompt']()).toBeNull();
    });

    it('re-enables the controls when the link cannot start', async () => {
      const httpError = new HttpErrorResponse({ status: 500 });
      authServiceMock.initOAuthLink.mockReturnValue(
        throwError(() => httpError)
      );

      component.connectProvider('facebook');
      component.stepUpPasswordModel.set({ currentPassword: 'Password1' });
      await fixture.whenStable();
      component['confirmStepUp']();

      expect(component.busy()).toBe(false);
      expect(notifyMock.error).toHaveBeenCalledWith(
        httpError,
        'auth.profile.errorInitiateLinkFailed'
      );
    });

    it('asks the page for a round trip on an account with no password', () => {
      fixture.componentRef.setInput('hasPassword', false);
      const changes = emitted();

      component.connectProvider('facebook');

      expect(changes).toEqual([
        { operation: STEP_UP_OPERATION.OAUTH_LINK, provider: 'facebook' }
      ]);
      expect(component['stepUpPrompt']()).toBeNull();
      expect(authServiceMock.initOAuthLink).not.toHaveBeenCalled();
    });
  });

  // The row an unlink deletes is a sign-in credential, so removing one costs
  // the same factor that adding one costs.
  describe('disconnectProvider', () => {
    it('ignores a provider name it does not know', () => {
      component.disconnectProvider('unknown-provider');

      expect(authServiceMock.unlinkOAuthAccount).not.toHaveBeenCalled();
      expect(component.busy()).toBe(false);
    });

    it('asks an account that holds a password for it, and removes nothing yet', () => {
      component.disconnectProvider('google');

      expect(component['stepUpPrompt']()).toEqual({
        provider: 'google',
        mode: 'unlink'
      });
      expect(authServiceMock.unlinkOAuthAccount).not.toHaveBeenCalled();
    });

    it('sends the password with the unlink request and reports the removal', async () => {
      const unlinked: string[] = [];
      component.unlinked.subscribe((provider) => unlinked.push(provider));

      component.disconnectProvider('google');
      component.stepUpPasswordModel.set({ currentPassword: 'Password1' });
      await fixture.whenStable();
      component['confirmStepUp']();

      expect(authServiceMock.unlinkOAuthAccount).toHaveBeenCalledWith(
        'google',
        'Password1'
      );
      expect(component['stepUpPrompt']()).toBeNull();
      expect(component.busy()).toBe(false);
      expect(unlinked).toEqual(['google']);
      expect(notifyMock.success).toHaveBeenCalledWith(
        'auth.profile.oauthDisconnected',
        { provider: 'Google' }
      );
    });

    it('keeps the provider when the server refuses the unlink', async () => {
      const httpError = new HttpErrorResponse({ status: 403 });
      authServiceMock.unlinkOAuthAccount.mockReturnValue(
        throwError(() => httpError)
      );
      const unlinked: string[] = [];
      component.unlinked.subscribe((provider) => unlinked.push(provider));

      component.disconnectProvider('google');
      component.stepUpPasswordModel.set({ currentPassword: 'Password1' });
      await fixture.whenStable();
      component['confirmStepUp']();

      expect(unlinked).toEqual([]);
      expect(component.busy()).toBe(false);
      expect(notifyMock.error).toHaveBeenCalledWith(
        httpError,
        'auth.profile.errorDisconnectFailed'
      );
    });

    it('asks the page for a round trip on an account with no password', () => {
      fixture.componentRef.setInput('hasPassword', false);
      const changes = emitted();

      component.disconnectProvider('google');

      expect(changes).toEqual([
        { operation: STEP_UP_OPERATION.OAUTH_UNLINK, provider: 'google' }
      ]);
      expect(authServiceMock.unlinkOAuthAccount).not.toHaveBeenCalled();
    });
  });

  describe('resuming after a round trip', () => {
    it('starts the link once, however often the input emits', async () => {
      const change: ProviderChange = {
        operation: STEP_UP_OPERATION.OAUTH_LINK,
        provider: 'facebook'
      };
      fixture.componentRef.setInput('resumeChange', change);
      fixture.detectChanges();
      fixture.componentRef.setInput('resumeChange', { ...change });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(authServiceMock.initOAuthLink).toHaveBeenCalledTimes(1);
      expect(authServiceMock.initOAuthLink).toHaveBeenCalledWith(undefined);
    });

    it('sends the unlink without a password', async () => {
      fixture.componentRef.setInput('resumeChange', {
        operation: STEP_UP_OPERATION.OAUTH_UNLINK,
        provider: 'google'
      });
      fixture.detectChanges();
      await fixture.whenStable();

      expect(authServiceMock.unlinkOAuthAccount).toHaveBeenCalledWith(
        'google',
        undefined
      );
    });
  });
});
