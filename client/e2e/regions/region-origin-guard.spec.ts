import {
  expect,
  signInOnRegionHost,
  SPA_HOST,
  test
} from '../fixtures/regions.fixture';

test.describe('The API host of a region', () => {
  test('refuses a request from another subdomain of the site, which carries its cookie', async ({
    page,
    baseURL,
    regions
  }) => {
    for (const mock of regions) {
      const { apiOrigin } = mock;
      const refreshUrl = `${apiOrigin}/api/v1/auth/refresh-token`;

      await signInOnRegionHost(page, mock);

      // Another page of the same site: `SameSite=strict` sends the refresh
      // cookie of the region host from it, and a no-cors request needs no
      // CORS answer to be sent.
      const sibling = new URL(baseURL ?? '');

      sibling.hostname = `other.${SPA_HOST}`;
      await page.goto(`${sibling.origin}/assets/i18n/en.json`);

      const [response] = await Promise.all([
        page.waitForResponse(refreshUrl),
        page.evaluate(
          (url) =>
            fetch(url, {
              method: 'POST',
              mode: 'no-cors',
              credentials: 'include'
            }).then(() => undefined),
          refreshUrl
        )
      ]);
      const headers = await response.request().allHeaders();

      expect(headers['origin']).toBe(sibling.origin);
      expect(headers['cookie']).toMatch(/refresh_token=/);
      expect(response.status()).toBe(403);

      // The same request from the SPA is served.
      await page.goto('/assets/i18n/en.json');
      const status = await page.evaluate(
        (url) =>
          fetch(url, { method: 'POST', credentials: 'include' }).then(
            (r) => r.status
          ),
        refreshUrl
      );

      expect(status).toBe(200);
    }
  });
});
