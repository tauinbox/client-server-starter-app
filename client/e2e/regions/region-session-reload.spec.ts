import { REGIONS } from '@app/shared/constants';
import type { MockUser } from '../fixtures/mock-data';
import { expect, test } from '../fixtures/regions.fixture';

test.describe('A session of a region whose API has its own host', () => {
  test('survives a reload: the refresh goes to the host of the region with its cookie', async ({
    page,
    regions
  }) => {
    // Each region with its own host, so a new region is covered with no edit.
    for (const { region, url, apiOrigin } of regions) {
      const [residenceCountry] = REGIONS[region].countries;
      // The control route stores a field that a test leaves out as null.
      const user = {
        id: `region-${region}`,
        email: `resident-${region}@example.com`,
        name: 'Regional Resident',
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

      await fetch(`${url}/__control/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([user])
      });

      // Sign in from the SPA origin, so the browser keeps the host-only
      // refresh cookie of the region host, as after a sign-in in the app.
      await page.goto('/assets/i18n/en.json');
      const signedIn = await page.evaluate(
        async ({ origin, email, password }) => {
          const response = await fetch(`${origin}/api/v1/auth/login`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
          });

          return ((await response.json()) as { user: unknown }).user;
        },
        { origin: apiOrigin, email: user.email, password: user.password }
      );

      await page.evaluate(
        ({ persisted, persistedRegion }) => {
          localStorage.setItem('auth_user', JSON.stringify(persisted));
          localStorage.setItem('auth_region', persistedRegion);
        },
        { persisted: signedIn, persistedRegion: region }
      );

      const apiOrigins: string[] = [];

      page.on('request', (request) => {
        const { origin, pathname } = new URL(request.url());

        if (pathname.startsWith('/api/')) apiOrigins.push(origin);
      });

      await page.goto('/profile');
      await expect(
        page.getByRole('heading', { level: 2, name: user.name })
      ).toBeVisible();

      await page.reload();
      await expect(
        page.getByRole('heading', { level: 2, name: user.name })
      ).toBeVisible();

      expect(apiOrigins.length).toBeGreaterThan(0);
      expect(new Set(apiOrigins)).toEqual(new Set([apiOrigin]));
    }
  });
});
