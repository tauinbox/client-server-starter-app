import { expect, signInOnRegionHost, test } from '../fixtures/regions.fixture';

test.describe('A session of a region whose API has its own host', () => {
  test('survives a reload: the refresh goes to the host of the region with its cookie', async ({
    page,
    regions
  }) => {
    // Each region with its own host, so a new region is covered with no edit.
    for (const mock of regions) {
      const { region, apiOrigin } = mock;
      const { user, signedIn } = await signInOnRegionHost(page, mock);

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
