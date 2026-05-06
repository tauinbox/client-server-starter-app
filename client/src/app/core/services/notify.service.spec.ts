import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslocoTestingModuleWithLangs } from '../../../test-utils/transloco-testing';

import { NotifyService } from './notify.service';

describe('NotifyService', () => {
  let service: NotifyService;
  let snackBarMock: { open: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    snackBarMock = { open: vi.fn() };

    TestBed.configureTestingModule({
      imports: [TranslocoTestingModuleWithLangs],
      providers: [{ provide: MatSnackBar, useValue: snackBarMock }]
    });

    service = TestBed.inject(NotifyService);
  });

  describe('success / info / warn', () => {
    it('translates the message key and uses the translated close label', () => {
      service.success('auth.profile.successUpdated');

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Profile updated successfully',
        'Close'
      );
    });

    it('forwards interpolation params to the translation', () => {
      service.info('auth.profile.oauthConnected', { provider: 'Google' });

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Google account connected successfully',
        'Close'
      );
    });

    it('opens the snackbar without an explicit config (relies on defaults)', () => {
      service.warn('common.cancel');

      const config = snackBarMock.open.mock.calls[0][2];
      expect(config).toBeUndefined();
    });
  });

  describe('error', () => {
    it('treats a string argument as a translation key', () => {
      service.error('auth.profile.errorLinkFailed');

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Failed to link OAuth account. Please try again.',
        'Close'
      );
    });

    it('translates a server-provided errorKey when present', () => {
      const httpError = new HttpErrorResponse({
        error: {
          errorKey: 'auth.profile.errorLinkFailed',
          message: 'raw fallback'
        },
        status: 400
      });

      service.error(httpError);

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Failed to link OAuth account. Please try again.',
        'Close'
      );
    });

    it('falls back to the server message when errorKey is missing', () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Something specific went wrong' },
        status: 400
      });

      service.error(httpError);

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Something specific went wrong',
        'Close'
      );
    });

    it('falls back to HttpErrorResponse.message when payload has no message', () => {
      const httpError = new HttpErrorResponse({
        error: null,
        status: 500,
        statusText: 'Internal Server Error'
      });

      service.error(httpError);

      const [message] = snackBarMock.open.mock.calls[0];
      expect(message).toContain('500');
    });

    it('uses the fallback translation key when payload has no errorKey or message', () => {
      const httpError = new HttpErrorResponse({
        error: null,
        status: 500
      });

      service.error(httpError, 'auth.profile.errorLinkFailed');

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Failed to link OAuth account. Please try again.',
        'Close'
      );
    });

    it('falls back to message when errorKey has no matching translation', () => {
      const httpError = new HttpErrorResponse({
        error: {
          errorKey: 'errors.unknownNonExistentKey',
          message: 'Server explanation'
        },
        status: 400
      });

      service.error(httpError);

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Server explanation',
        'Close'
      );
    });
  });
});
