import type { BrowserContext, Page } from '@playwright/test';
import { REGIONS } from '@app/shared/constants';
import type { UserResponse } from '@app/shared/types';
import { chooseOption, markOAuthRoundTripStarted } from '../fixtures/helpers';
import type { MockUser } from '../fixtures/mock-data';
import { expect, test, type RegionMock } from '../fixtures/regions.fixture';

const COUNTRY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

async function control<T>(
  { url }: RegionMock,
  { path, body }: { path: string; body: unknown }
): Promise<T> {
  const res = await fetch(`${url}/__control/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  expect(res.ok).toBe(true);

  return (await res.json()) as T;
}

/** Records the origin of each request of the page to `path`. */
function recordOrigins(page: Page, path: string): string[] {
  const origins: string[] = [];

  page.on('request', (request) => {
    const url = new URL(request.url());

    if (url.pathname === path) origins.push(url.origin);
  });

  return origins;
}

/**
 * Comes back to the callback as the browser does from a provider that the
 * API host of the region started: the intent of this tab names the region,
 * and that host holds the result in host-only cookies.
 */
async function arriveFromRegionHost(
  { page, context }: { page: Page; context: BrowserContext },
  { mock, cookies }: { mock: RegionMock; cookies: Record<string, string> }
): Promise<void> {
  await page.goto('/login');
  await markOAuthRoundTripStarted(page, '/profile', mock.region);
  await context.addCookies(
    Object.entries(cookies).map(([name, value]) => ({
      name,
      value,
      url: `${mock.apiOrigin}/`
    }))
  );
  await page.goto('/oauth/callback');
}

const EXCHANGE_PATH = '/api/v1/auth/oauth/exchange';

// The provider returns to the API host of the region that started the round
// trip, and only that host holds its result. So the callback page finishes
// the sign-in there, and the session stays in that region.
test.describe('An OAuth sign-in that a region host with its own API started', () => {
  test('finishes on the host of that region and keeps the session there', async ({
    page,
    context,
    regions
  }) => {
    const exchanges = recordOrigins(page, EXCHANGE_PATH);

    for (const mock of regions) {
      const { region, apiOrigin } = mock;
      const [residenceCountry] = REGIONS[region].countries;
      const user = {
        id: `oauth-${region}`,
        email: `oauth-resident-${region}@example.com`,
        name: 'Provider Resident',
        password: 'Password1',
        isActive: true,
        roles: ['user'],
        isEmailVerified: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        locale: 'en',
        residenceCountry,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z'
      } satisfies Partial<MockUser>;

      exchanges.length = 0;
      await control(mock, { path: 'users', body: [user] });
      const { token } = await control<{ token: string }>(mock, {
        path: 'oauth-data',
        body: { userId: user.id }
      });

      await arriveFromRegionHost(
        { page, context },
        { mock, cookies: { oauth_data: token } }
      );

      await expect(page).toHaveURL(/\/profile$/);
      await expect(
        page.getByRole('heading', { level: 2, name: user.name })
      ).toBeVisible();
      expect(exchanges).toEqual([apiOrigin]);
      expect(
        await page.evaluate(() => localStorage.getItem('auth_region'))
      ).toBe(region);

      // The refresh cookie is host-only on the host of the region.
      await page.reload();
      await expect(
        page.getByRole('heading', { level: 2, name: user.name })
      ).toBeVisible();

      await page.evaluate(() => localStorage.clear());
      await context.clearCookies();
    }
  });

  test('creates the account of a new identity in the instance of that region', async ({
    page,
    context,
    regions
  }) => {
    const signups = recordOrigins(page, '/api/v1/auth/oauth/signup');

    for (const mock of regions) {
      const { region, apiOrigin, url } = mock;
      const [country] = REGIONS[region].countries;
      const email = `oauth-new-${region}@example.com`;
      const { token, signupToken } = await control<{
        token: string;
        signupToken: string;
      }>(mock, {
        path: 'oauth-signup',
        body: { email, name: 'New Provider User' }
      });

      signups.length = 0;
      await arriveFromRegionHost(
        { page, context },
        { mock, cookies: { oauth_data: token, oauth_signup: signupToken } }
      );

      await chooseOption(
        page,
        'Country of residence',
        COUNTRY_NAMES.of(country)!
      );
      await page.getByRole('button', { name: 'Create account' }).click();

      await expect(page).toHaveURL(/\/profile$/);
      expect(signups).toEqual([apiOrigin]);

      const state = await fetch(`${url}/__control/state`);
      const { users } = (await state.json()) as { users: UserResponse[] };

      expect(users.map((user) => user.email)).toContain(email);

      await page.evaluate(() => localStorage.clear());
      await context.clearCookies();
    }
  });
});
