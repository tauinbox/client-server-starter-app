import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ErrorKeys } from '@app/shared/constants';
import { provideNoopMaterialAnimations } from '../../../../../test-utils/material-animations';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

import type { MailedTokenAction } from './mailed-token.component';
import { MailedTokenComponent } from './mailed-token.component';
import { AuthService } from '../../services/auth.service';

describe.each<{
  action: MailedTokenAction;
  title: string;
  noToken: string;
  fallback: string;
  errorKey: string;
  serverText: string;
}>([
  {
    action: 'verifyEmail',
    title: 'Email verification',
    noToken: 'No verification token provided.',
    fallback: 'Email verification failed. The token may be invalid or expired.',
    errorKey: ErrorKeys.AUTH.VERIFICATION_TOKEN_EXPIRED,
    serverText: 'Verification token has expired. Please request a new one.'
  },
  {
    action: 'confirmEmailChange',
    title: 'Confirm email change',
    noToken: 'No confirmation token provided.',
    fallback:
      'Email change confirmation failed. The token may be invalid or expired.',
    errorKey: ErrorKeys.AUTH.PENDING_EMAIL_TOKEN_EXPIRED,
    serverText: 'Email-change confirmation token is invalid or expired'
  }
])(
  'MailedTokenComponent ($action)',
  ({ action, title, noToken, fallback, errorKey, serverText }) => {
    let component: MailedTokenComponent;
    let fixture: ComponentFixture<MailedTokenComponent>;
    let authServiceMock: Record<MailedTokenAction, ReturnType<typeof vi.fn>>;
    const call = (): ReturnType<typeof vi.fn> => authServiceMock[action];

    function createComponent(token: string | undefined): void {
      TestBed.configureTestingModule({
        imports: [MailedTokenComponent, TranslocoTestingModuleWithLangs],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopMaterialAnimations(),
          { provide: AuthService, useValue: authServiceMock }
        ]
      });

      fixture = TestBed.createComponent(MailedTokenComponent);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('action', action);
      fixture.componentRef.setInput('token', token);
      fixture.detectChanges();
    }

    beforeEach(() => {
      authServiceMock = {
        verifyEmail: vi.fn(),
        confirmEmailChange: vi.fn()
      };
    });

    afterEach(() => {
      TestBed.resetTestingModule();
    });

    it('should show the title of its action', () => {
      call().mockReturnValue(of({ message: 'ok' }));
      createComponent('valid-token');

      expect(fixture.nativeElement.textContent).toContain(title);
    });

    describe('ngOnInit — no token', () => {
      it('should set error and stop loading when no token provided', () => {
        createComponent(undefined);

        expect(component['loading']()).toBe(false);
        expect(component['success']()).toBe(false);
        expect(component['error']()).toBe(noToken);
      });

      it('should call no service method when token is missing', () => {
        createComponent(undefined);

        expect(authServiceMock.verifyEmail).not.toHaveBeenCalled();
        expect(authServiceMock.confirmEmailChange).not.toHaveBeenCalled();
      });
    });

    describe('ngOnInit — with token', () => {
      it('should call only the service method of its action with the token', () => {
        call().mockReturnValue(of({ message: 'ok' }));
        createComponent('my-token');

        expect(call()).toHaveBeenCalledWith('my-token');
        const other: MailedTokenAction =
          action === 'verifyEmail' ? 'confirmEmailChange' : 'verifyEmail';
        expect(authServiceMock[other]).not.toHaveBeenCalled();
      });

      it('should set success to true and loading to false on success', () => {
        call().mockReturnValue(of({ message: 'ok' }));
        createComponent('valid-token');

        expect(component['loading']()).toBe(false);
        expect(component['success']()).toBe(true);
        expect(component['error']()).toBeNull();
      });

      it('should set error from server on failure', () => {
        const httpError = new HttpErrorResponse({
          error: { errorKey, message: 'Token expired' },
          status: 400
        });
        call().mockReturnValue(throwError(() => httpError));
        createComponent('expired-token');

        expect(component['loading']()).toBe(false);
        expect(component['success']()).toBe(false);
        expect(component['error']()).toBe(serverText);
      });

      it('should show fallback error when no server message on failure', () => {
        const httpError = new HttpErrorResponse({ error: null, status: 500 });
        call().mockReturnValue(throwError(() => httpError));
        createComponent('some-token');

        expect(component['error']()).toBe(fallback);
      });
    });
  }
);
