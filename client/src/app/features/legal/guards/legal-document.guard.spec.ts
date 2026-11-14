import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { UrlSegment, type CanMatchFn, type Route } from '@angular/router';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';
import { LEGAL_DRAFTS_VISIBLE } from '../services/legal-jurisdiction.service';
import { legalDocumentGuard } from './legal-document.guard';

function matches(path: string, draftsVisible: boolean): unknown {
  TestBed.configureTestingModule({
    imports: [TranslocoTestingModuleWithLangs],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: LEGAL_DRAFTS_VISIBLE, useValue: draftsVisible }
    ]
  });

  const segments = path.split('/').map((p) => new UrlSegment(p, {}));

  return TestBed.runInInjectionContext(() =>
    legalDocumentGuard({} as Route, segments, {} as Parameters<CanMatchFn>[2])
  );
}

describe('legalDocumentGuard', () => {
  it('matches a known document while drafts are on show', () => {
    expect(matches('legal/ru/privacy', true)).toBe(true);
  });

  it('does not match a draft in a build that hides drafts', () => {
    expect(matches('legal/ru/privacy', false)).toBe(false);
  });

  it.each(['legal/de/privacy', 'legal/ru/cookies', 'legal/__proto__/terms'])(
    'does not match the unknown document %s',
    (path) => {
      expect(matches(path, true)).toBe(false);
    }
  );
});
