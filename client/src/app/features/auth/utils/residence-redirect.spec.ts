import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterResidenceUrl, residenceRedirect } from './residence-redirect';

const ORIGIN = 'https://app.example.com';

describe('residenceRedirect', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    router = TestBed.inject(Router);
  });

  const store = (owed: boolean) => ({ mustDeclareResidence: () => owed });

  it('lets an account with a country go on', () => {
    expect(residenceRedirect(store(false), router, '/billing')).toBeNull();
  });

  it('sends an account with no country to the residence page with its target', () => {
    expect(
      String(residenceRedirect(store(true), router, '/billing?tab=plans'))
    ).toBe('/residence?returnUrl=%2Fbilling%3Ftab%3Dplans');
  });

  it.each(['/residence', '/residence?returnUrl=%2Fprofile', '/residence#x'])(
    'keeps the residence page itself (%s)',
    (url) => {
      expect(residenceRedirect(store(true), router, url)).toBeNull();
    }
  );
});

describe('afterResidenceUrl', () => {
  it('follows a same-origin target', () => {
    expect(afterResidenceUrl('/billing?tab=plans', ORIGIN)).toBe(
      '/billing?tab=plans'
    );
  });

  it.each([
    ['another origin', 'https://evil.example/x'],
    ['a backslash path', '/\\evil.example'],
    ['the residence page', '/residence?returnUrl=%2Fresidence'],
    ['no target', null]
  ])('goes to the root for %s', (_label, url) => {
    expect(afterResidenceUrl(url, ORIGIN)).toBe('/');
  });
});
