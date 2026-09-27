import { TestBed } from '@angular/core/testing';
import { OAuthIntentService } from './oauth-intent.service';

const KEY = 'oauth_return_url';

describe('OAuthIntentService', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  // Each call is a new page load: the service is created once per bootstrap.
  function bootstrap(): OAuthIntentService {
    TestBed.resetTestingModule();
    return TestBed.inject(OAuthIntentService);
  }

  it('hands the return url of the previous page load to one reader', () => {
    bootstrap().start('/admin/users');

    const next = bootstrap();

    expect(next.take()).toBe('/admin/users');
    expect(next.take()).toBeNull();
  });

  it('takes the value out of storage at bootstrap, so a later load gets nothing', () => {
    bootstrap().start('/admin/users');
    bootstrap();

    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(bootstrap().take()).toBeNull();
  });

  it('gives the page that starts the round trip nothing to take', () => {
    const page = bootstrap();

    page.start('/profile');

    expect(page.take()).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBe('/profile');
  });

  it('refuses a stored value that is not a string', () => {
    sessionStorage.setItem(KEY, '42');

    expect(bootstrap().take()).toBeNull();
  });

  it('drops the stored value when the page comes back from the back/forward cache', () => {
    bootstrap().start('/profile');

    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true })
    );

    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the stored value on an ordinary page show', () => {
    bootstrap().start('/profile');

    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: false })
    );

    expect(sessionStorage.getItem(KEY)).toBe('/profile');
  });
});
