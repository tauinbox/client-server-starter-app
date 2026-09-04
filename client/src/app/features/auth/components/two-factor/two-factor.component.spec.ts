import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import type { RoleResponse, UserResponse } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { NotifyService } from '@core/services/notify.service';
import { AuthService } from '../../services/auth.service';
import { TwoFactorComponent } from './two-factor.component';

const mockRole: RoleResponse = {
  id: 'role-user',
  name: 'user',
  description: 'Regular user',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

function buildUser(overrides: Partial<UserResponse> = {}): UserResponse {
  return {
    id: '1',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    isActive: true,
    roles: [mockRole],
    isEmailVerified: true,
    hasPassword: true,
    mfaEnabled: false,
    locale: 'en',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides
  };
}

describe('TwoFactorComponent', () => {
  let component: TwoFactorComponent;
  let fixture: ComponentFixture<TwoFactorComponent>;
  let authServiceMock: {
    startMfaSetup: ReturnType<typeof vi.fn>;
    enableMfa: ReturnType<typeof vi.fn>;
    disableMfa: ReturnType<typeof vi.fn>;
  };
  let notifyMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authServiceMock = {
      startMfaSetup: vi.fn().mockReturnValue(
        of({
          secret: 'JBSWY3DPEHPK3PXP',
          otpauthUri:
            'otpauth://totp/Nexus:test@example.com?secret=JBSWY3DPEHPK3PXP',
          qrDataUrl: 'data:image/png;base64,AAAA'
        })
      ),
      enableMfa: vi
        .fn()
        .mockReturnValue(of({ recoveryCodes: ['AAAAAAAA-AAAAAAAA'] })),
      disableMfa: vi.fn().mockReturnValue(of({ message: 'off' }))
    };
    notifyMock = { success: vi.fn(), error: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [TwoFactorComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: AuthService, useValue: authServiceMock },
        { provide: NotifyService, useValue: notifyMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TwoFactorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('user', buildUser());
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('asks an account created through a provider for a password first', () => {
    fixture.componentRef.setInput('user', buildUser({ hasPassword: false }));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Set a password for this account');
  });

  it('offers the provider round trip when a provider is connected', () => {
    fixture.componentRef.setInput('user', buildUser({ hasPassword: false }));
    fixture.componentRef.setInput('reauthProviderLabel', 'Google');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Set a password for this account');
    expect(text).toContain('Google');
  });

  it('asks the page for a round trip instead of a password', () => {
    fixture.componentRef.setInput('user', buildUser({ hasPassword: false }));
    fixture.componentRef.setInput('reauthProviderLabel', 'Google');
    fixture.detectChanges();

    const asked = vi.fn();
    component.reauthRequested.subscribe(asked);

    component.startEnrolment();
    fixture.detectChanges();

    expect(asked).toHaveBeenCalledTimes(1);
    expect(authServiceMock.startMfaSetup).not.toHaveBeenCalled();
  });

  it('resumes the enrolment on the load that follows the round trip', async () => {
    fixture.componentRef.setInput('user', buildUser({ hasPassword: false }));
    fixture.componentRef.setInput('reauthProviderLabel', 'Google');
    fixture.componentRef.setInput('resumeSetup', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The proof travels as an httpOnly cookie, so no factor is sent.
    expect(authServiceMock.startMfaSetup).toHaveBeenCalledWith();
    const img: HTMLImageElement | null =
      fixture.nativeElement.querySelector('.two-factor-qr');
    expect(img?.src).toContain('data:image/png;base64,AAAA');
  });

  it('turns the factor off with a code when the account holds no password', async () => {
    fixture.componentRef.setInput(
      'user',
      buildUser({ hasPassword: false, mfaEnabled: true })
    );
    fixture.componentRef.setInput('reauthProviderLabel', 'Google');
    fixture.detectChanges();

    component.startDisable();
    fixture.detectChanges();

    // The password field is the one this account can never fill.
    expect(fixture.nativeElement.textContent as string).not.toContain(
      'Confirm your password'
    );

    component.codeModel.set({ code: '123456' });
    component.disable();
    await fixture.whenStable();

    expect(authServiceMock.disableMfa).toHaveBeenCalledWith({
      code: '123456'
    });
    expect(notifyMock.success).toHaveBeenCalledWith('auth.twoFactor.disabled');
  });

  it('demands the password before it asks the server for a secret', async () => {
    component.startEnrolment();
    fixture.detectChanges();

    component.requestSecret();
    await fixture.whenStable();

    // The form is invalid with an empty password, so nothing is requested.
    expect(authServiceMock.startMfaSetup).not.toHaveBeenCalled();
  });

  it('shows the QR code and the manual key once the setup lands', async () => {
    component.startEnrolment();
    component.passwordModel.set({ currentPassword: 'Password1' });
    fixture.detectChanges();

    component.requestSecret();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(authServiceMock.startMfaSetup).toHaveBeenCalledWith('Password1');
    const img: HTMLImageElement | null =
      fixture.nativeElement.querySelector('.two-factor-qr');
    expect(img?.src).toContain('data:image/png;base64,AAAA');
    expect(fixture.nativeElement.textContent).toContain('JBSWY3DPEHPK3PXP');
  });

  it('shows the recovery codes only after a code turns the factor on', async () => {
    component.startEnrolment();
    component.passwordModel.set({ currentPassword: 'Password1' });
    component.requestSecret();
    await fixture.whenStable();

    component.codeModel.set({ code: '123456' });
    component.confirmCode();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(authServiceMock.enableMfa).toHaveBeenCalledWith('123456');
    expect(fixture.nativeElement.textContent).toContain('AAAAAAAA-AAAAAAAA');
    expect(notifyMock.success).toHaveBeenCalledWith('auth.twoFactor.enabled');
  });

  it('drops the codes from the screen once the user acknowledges them', async () => {
    component.startEnrolment();
    component.passwordModel.set({ currentPassword: 'Password1' });
    component.requestSecret();
    await fixture.whenStable();
    component.codeModel.set({ code: '123456' });
    component.confirmCode();
    await fixture.whenStable();

    component.acknowledgeCodes();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain(
      'AAAAAAAA-AAAAAAAA'
    );
  });

  it('reports a wrong code and leaves the factor off', async () => {
    authServiceMock.enableMfa.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            error: { errorKey: 'errors.auth.mfaInvalidCode' }
          })
      )
    );
    component.startEnrolment();
    component.passwordModel.set({ currentPassword: 'Password1' });
    component.requestSecret();
    await fixture.whenStable();

    component.codeModel.set({ code: '000000' });
    component.confirmCode();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(notifyMock.error).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain(
      'AAAAAAAA-AAAAAAAA'
    );
  });

  it('sends the password when the account turns the factor off', async () => {
    fixture.componentRef.setInput('user', buildUser({ mfaEnabled: true }));
    fixture.detectChanges();

    component.startDisable();
    component.passwordModel.set({ currentPassword: 'Password1' });
    component.disable();
    await fixture.whenStable();

    expect(authServiceMock.disableMfa).toHaveBeenCalledWith({
      currentPassword: 'Password1'
    });
    expect(notifyMock.success).toHaveBeenCalledWith('auth.twoFactor.disabled');
  });
});
