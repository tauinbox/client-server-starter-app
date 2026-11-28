import { TestBed } from '@angular/core/testing';
import { DATA_REGIONS, HOME_DATA_REGION } from '@app/shared/constants';
import { OAuthIntentService, type OAuthIntent } from './oauth-intent.service';

const KEY = 'oauth_intent';

const [OTHER_REGION] = DATA_REGIONS.filter(
  (region) => region !== HOME_DATA_REGION
);

const intent = (returnUrl: string): OAuthIntent => ({
  returnUrl,
  region: OTHER_REGION,
  provider: 'google'
});

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

  it('hands the return url and the region of the previous page load to one reader', () => {
    bootstrap().start(intent('/admin/users'));

    const next = bootstrap();

    expect(next.take()).toEqual(intent('/admin/users'));
    expect(next.take()).toBeNull();
  });

  it('takes the value out of storage at bootstrap, so a later load gets nothing', () => {
    bootstrap().start(intent('/admin/users'));
    bootstrap();

    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(bootstrap().take()).toBeNull();
  });

  it('gives the page that starts the round trip nothing to take', () => {
    const page = bootstrap();

    page.start(intent('/profile'));

    expect(page.take()).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(KEY) ?? 'null')).toEqual(
      intent('/profile')
    );
  });

  it('hands over the country that the user declared before a restart', () => {
    const declared: OAuthIntent = {
      ...intent('/profile'),
      residenceCountry: 'RU'
    };

    bootstrap().start(declared);

    expect(bootstrap().take()).toEqual(declared);
  });

  it.each([
    ['a number', 42],
    ['a bare return url', '/profile'],
    ['no region', { returnUrl: '/profile', provider: 'google' }],
    [
      'a region that the code does not know',
      { returnUrl: '/', region: 'xx', provider: 'google' }
    ],
    [
      'a return url that is not a string',
      { returnUrl: 1, region: HOME_DATA_REGION, provider: 'google' }
    ],
    ['no provider', { returnUrl: '/', region: HOME_DATA_REGION }],
    [
      'a provider that the code does not know',
      { returnUrl: '/', region: HOME_DATA_REGION, provider: 'toString' }
    ],
    [
      'a country that the code does not know',
      {
        returnUrl: '/',
        region: HOME_DATA_REGION,
        provider: 'google',
        residenceCountry: 'XX'
      }
    ]
  ])('refuses a stored value with %s', (_case, value) => {
    sessionStorage.setItem(KEY, JSON.stringify(value));

    expect(bootstrap().take()).toBeNull();
  });

  it('drops the stored value when the page comes back from the back/forward cache', () => {
    bootstrap().start(intent('/profile'));

    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true })
    );

    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the stored value on an ordinary page show', () => {
    bootstrap().start(intent('/profile'));

    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: false })
    );

    expect(sessionStorage.getItem(KEY)).not.toBeNull();
  });
});
