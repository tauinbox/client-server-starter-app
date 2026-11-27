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

      // With no referrer the Fetch standard gives `Origin: null` and Chromium
      // sends the origin of the page: either is refused, and neither is a
      // request with no Origin.
      const [hidden] = await Promise.all([
        page.waitForResponse(refreshUrl),
        page.evaluate(
          (url) =>
            fetch(url, {
              method: 'POST',
              mode: 'no-cors',
              credentials: 'include',
              referrerPolicy: 'no-referrer'
            }).then(() => undefined),
          refreshUrl
        )
      ]);

      expect((await hidden.request().allHeaders())['origin']).toMatch(
        /^(null|http:\/\/other\.)/
      );
      expect(hidden.status()).toBe(403);

      // A form post is a navigation and carries `Origin` too.
      const [submitted] = await Promise.all([
        page.waitForResponse(refreshUrl),
        page.evaluate((url) => {
          const form = document.createElement('form');

          form.method = 'POST';
          form.action = url;
          document.body.append(form);
          form.submit();
        }, refreshUrl)
      ]);
      const formHeaders = await submitted.request().allHeaders();

      expect(formHeaders['origin']).toBe(sibling.origin);
      expect(formHeaders['cookie']).toMatch(/refresh_token=/);
      expect(submitted.status()).toBe(403);
      await page.waitForURL(refreshUrl);

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
