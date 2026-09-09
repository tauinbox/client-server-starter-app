import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { ErrorKeys } from '@app/shared/constants';
import type { AuthResponse, RoleResponse } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

import { MfaChallengeComponent } from './mfa-challenge.component';
import { AuthService } from '../../services/auth.service';

const mockUserRole: RoleResponse = {
  id: 'role-user',
  name: 'user',
  description: 'Regular user',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

const mockAuthResponse: AuthResponse = {
  tokens: { access_token: 'token', expires_in: 3600 },
  user: {
    id: '1',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    isActive: true,
    roles: [mockUserRole],
    isEmailVerified: true,
    hasPassword: true,
    mfaEnabled: true,
    locale: 'en',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null
  }
};

describe('MfaChallengeComponent', () => {
  let fixture: ComponentFixture<MfaChallengeComponent>;
  let component: MfaChallengeComponent;
  let authServiceMock: {
    verifyMfa: ReturnType<typeof vi.fn>;
    verifyMfaRecoveryCode: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authServiceMock = {
      verifyMfa: vi.fn().mockReturnValue(of(mockAuthResponse)),
      verifyMfaRecoveryCode: vi.fn().mockReturnValue(of(mockAuthResponse))
    };

    await TestBed.configureTestingModule({
      imports: [MfaChallengeComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        { provide: AuthService, useValue: authServiceMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(MfaChallengeComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('challenge', {
      mfaRequired: true,
      mfaToken: 'pending-token',
      expiresIn: 300
    });
    fixture.detectChanges();
    await fixture.whenStable();
  });

  async function typeCode(value: string): Promise<void> {
    const input: HTMLInputElement = fixture.nativeElement.querySelector(
      'input[autocomplete="one-time-code"]'
    );
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function submit(): Promise<void> {
    const challengeForm: HTMLFormElement =
      fixture.nativeElement.querySelector('form');
    challengeForm.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function clickLink(index: number): void {
    const buttons: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.mfa-links button')
    );
    buttons[index].click();
  }

  it('offers the authenticator field first', () => {
    expect(
      fixture.nativeElement.querySelector('input[autocomplete="one-time-code"]')
    ).toBeTruthy();
  });

  it('sends the code to the verify route and reports success', async () => {
    const verified = vi.fn();
    component.verified.subscribe(verified);

    await typeCode('123456');
    await submit();

    expect(authServiceMock.verifyMfa).toHaveBeenCalledWith(
      'pending-token',
      '123456'
    );
    expect(verified).toHaveBeenCalled();
  });

  it('trims the code before it is sent', async () => {
    await typeCode('  123456  ');
    await submit();

    expect(authServiceMock.verifyMfa).toHaveBeenCalledWith(
      'pending-token',
      '123456'
    );
  });

  it('sends a recovery code to the recovery route instead', async () => {
    clickLink(0);
    fixture.detectChanges();

    await typeCode('AAAAAAAA-AAAAAAAA');
    await submit();

    expect(authServiceMock.verifyMfaRecoveryCode).toHaveBeenCalledWith(
      'pending-token',
      'AAAAAAAA-AAAAAAAA'
    );
    expect(authServiceMock.verifyMfa).not.toHaveBeenCalled();
  });

  it('clears the typed code when the input is switched', async () => {
    await typeCode('123456');

    clickLink(0);
    fixture.detectChanges();
    await fixture.whenStable();

    const input: HTMLInputElement = fixture.nativeElement.querySelector(
      'input[autocomplete="one-time-code"]'
    );
    expect(input.value).toBe('');
  });

  it('keeps the form up and shows the reason when only the code was wrong', async () => {
    const expired = vi.fn();
    component.expired.subscribe(expired);
    authServiceMock.verifyMfa.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            error: {
              errorKey: ErrorKeys.AUTH.MFA_INVALID_CODE,
              message: 'wrong code'
            }
          })
      )
    );

    await typeCode('000000');
    await submit();

    expect(expired).not.toHaveBeenCalled();
    expect(
      fixture.nativeElement.querySelector('.error-message')?.textContent?.trim()
    ).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('input[autocomplete="one-time-code"]')
    ).toBeTruthy();
  });

  it('reports an expired challenge to the host rather than showing it', async () => {
    const expired = vi.fn();
    component.expired.subscribe(expired);
    authServiceMock.verifyMfa.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 401,
            error: {
              errorKey: ErrorKeys.AUTH.MFA_INVALID_PENDING_TOKEN,
              message: 'expired'
            }
          })
      )
    );

    await typeCode('123456');
    await submit();

    expect(expired).toHaveBeenCalledWith(expect.any(String));
  });

  it('reports a cancellation to the host', () => {
    const cancelled = vi.fn();
    component.cancelled.subscribe(cancelled);

    clickLink(1);

    expect(cancelled).toHaveBeenCalled();
  });

  it('sends nothing while the field is empty', async () => {
    await submit();

    expect(authServiceMock.verifyMfa).not.toHaveBeenCalled();
  });
});
