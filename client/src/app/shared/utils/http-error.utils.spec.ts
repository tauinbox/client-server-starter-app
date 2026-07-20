import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslocoService } from '@jsverse/transloco';
import { TranslocoTestingModuleWithLangs } from '../../../test-utils/transloco-testing';

import { parseHttpErrorMessage } from './http-error.utils';

describe('parseHttpErrorMessage', () => {
  let transloco: TranslocoService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModuleWithLangs]
    });
    transloco = TestBed.inject(TranslocoService);
  });

  it('prefers a server errorKey that maps to a translation', () => {
    const error = new HttpErrorResponse({
      error: {
        errorKey: 'auth.profile.errorLinkFailed',
        message: 'raw server text'
      },
      status: 400
    });

    expect(parseHttpErrorMessage(error, transloco, 'common.cancel')).toBe(
      'Failed to link OAuth account. Please try again.'
    );
  });

  it('translates a generic message for ValidationPipe array payloads', () => {
    const error = new HttpErrorResponse({
      error: { message: ['isActive must be a boolean value'] },
      status: 400
    });

    expect(parseHttpErrorMessage(error, transloco)).toBe(
      'Some of the submitted values are invalid. Please check the form and try again.'
    );
  });

  it('prefers the translated fallback key over a raw server message', () => {
    const error = new HttpErrorResponse({
      error: { message: 'Untranslated server text' },
      status: 400
    });

    expect(
      parseHttpErrorMessage(error, transloco, 'auth.profile.errorLinkFailed')
    ).toBe('Failed to link OAuth account. Please try again.');
  });

  it('passes a single-string server message through when no fallback is given', () => {
    const error = new HttpErrorResponse({
      error: { message: 'Something specific went wrong' },
      status: 400
    });

    expect(parseHttpErrorMessage(error, transloco)).toBe(
      'Something specific went wrong'
    );
  });

  it('falls back to the status code when there is no payload', () => {
    const error = new HttpErrorResponse({ error: null, status: 500 });

    expect(parseHttpErrorMessage(error, transloco)).toContain('500');
  });
});
