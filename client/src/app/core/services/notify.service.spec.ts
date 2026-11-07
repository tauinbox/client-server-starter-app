import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslocoService } from '@jsverse/transloco';
import type { Translation } from '@jsverse/transloco';
import { Subject } from 'rxjs';
import type { MockInstance } from 'vitest';
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

      const [[, , config]] = snackBarMock.open.mock.calls;

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

    it('shows a translated generic message for ValidationPipe array payloads', () => {
      const httpError = new HttpErrorResponse({
        error: {
          message: [
            'isActive must be a boolean value',
            'email must be an email'
          ]
        },
        status: 400
      });

      service.error(httpError);

      const [[message]] = snackBarMock.open.mock.calls;

      expect(message).toBe(
        'Some of the submitted values are invalid. Please check the form and try again.'
      );
      expect(message).not.toContain('isActive');
    });

    it('falls back to HttpErrorResponse.message when payload has no message', () => {
      const httpError = new HttpErrorResponse({
        error: null,
        status: 500,
        statusText: 'Internal Server Error'
      });

      service.error(httpError);

      const [[message]] = snackBarMock.open.mock.calls;

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

  describe('translation loading', () => {
    let transloco: TranslocoService;
    let authScope$: Subject<Translation>;
    let load: MockInstance<TranslocoService['load']>;

    beforeEach(() => {
      transloco = TestBed.inject(TranslocoService);
      authScope$ = new Subject<Translation>();
      const original = transloco.load.bind(transloco);

      load = vi
        .spyOn(transloco, 'load')
        .mockImplementation((path, options) =>
          path === 'auth/en' ? authScope$ : original(path, options)
        );
    });

    it('opens a scoped message only after its scope has loaded', () => {
      service.success('auth.profile.successUpdated');

      expect(load).toHaveBeenCalledWith('en');
      expect(load).toHaveBeenCalledWith('auth/en');
      expect(snackBarMock.open).not.toHaveBeenCalled();

      authScope$.next({});

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Profile updated successfully',
        'Close'
      );
    });

    it('waits for the scope of the fallback key of an HTTP error', () => {
      service.error(
        new HttpErrorResponse({ error: null, status: 500 }),
        'auth.profile.errorLinkFailed'
      );

      expect(snackBarMock.open).not.toHaveBeenCalled();

      authScope$.next({});

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Failed to link OAuth account. Please try again.',
        'Close'
      );
    });

    it('loads no scope for a root key', () => {
      service.info('common.cancel');

      expect(load).toHaveBeenCalledTimes(1);
      expect(load).toHaveBeenCalledWith('en');
      expect(snackBarMock.open).toHaveBeenCalledTimes(1);
    });

    it('still opens the message when the scope fails to load', () => {
      service.success('auth.profile.successUpdated');

      authScope$.error(new Error('offline'));

      expect(snackBarMock.open).toHaveBeenCalledTimes(1);
    });

    it('keeps the later message when an earlier one waits for its scope', () => {
      service.success('auth.profile.successUpdated');
      service.info('common.cancel');
      authScope$.next({});

      expect(snackBarMock.open).toHaveBeenCalledTimes(1);
      expect(snackBarMock.open).toHaveBeenCalledWith('Cancel', 'Close');
    });
  });

  describe('reportLater', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function refusal(): HttpErrorResponse {
      return new HttpErrorResponse({ error: null, status: 409 });
    }

    it('runs the callback in a later macrotask', () => {
      vi.useFakeTimers();
      const show = vi.fn();

      service.reportLater(refusal(), show);
      expect(show).not.toHaveBeenCalled();

      vi.runAllTimers();
      expect(show).toHaveBeenCalledTimes(1);
    });

    it('skips the callback after error() of the same object', () => {
      vi.useFakeTimers();
      const error = refusal();
      const show = vi.fn();

      service.reportLater(error, show);
      service.error(error);
      vi.runAllTimers();

      expect(show).not.toHaveBeenCalled();
      expect(snackBarMock.open).toHaveBeenCalledTimes(1);
    });

    it('skips the callback after markReported() of the same object', () => {
      vi.useFakeTimers();
      const error = refusal();
      const show = vi.fn();

      service.reportLater(error, show);
      service.markReported(error);
      vi.runAllTimers();

      expect(show).not.toHaveBeenCalled();
    });

    it('runs the callback when another error object was reported', () => {
      vi.useFakeTimers();
      const show = vi.fn();

      service.reportLater(refusal(), show);
      service.error(refusal());
      vi.runAllTimers();

      expect(show).toHaveBeenCalledTimes(1);
    });
  });
});
