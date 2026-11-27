import { expect, signInOnRegionHost, test } from '../fixtures/regions.fixture';

// The link intent cookie is host-only on the API host that answered
// `link-init`, and the provider start is a top-level navigation that no HTTP
// interceptor sees. So the start must go to the host of the region too, or
// the server that starts the round trip holds no intent.
test.describe('A provider link in a region whose API has its own host', () => {
  test('starts the round trip on the host that accepted the link', async ({
    page,
    regions
  }) => {
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

      await page.goto('/profile');
      await expect(
        page.getByRole('heading', { level: 2, name: user.name })
      ).toBeVisible();

      await page
        .locator('.oauth-provider-row')
        .filter({ hasText: 'Google' })
        .getByRole('button', { name: /^Connect$/i })
        .click();

      const prompt = page.locator('.oauth-step-up-confirm');
      const accepted = page.waitForResponse(
        (res) =>
          res.url() === `${apiOrigin}/api/v1/auth/oauth/link-init` &&
          res.request().method() === 'POST'
      );

      await prompt.getByLabel('Current password').fill('Password1');
      await prompt.getByRole('button', { name: 'Continue' }).click();

      expect((await accepted).status()).toBe(201);

      // The provider half answers 501 in the mock, so the address is the
      // proof that the browser left for the start on the host of the region.
      await expect(page).toHaveURL(`${apiOrigin}/api/v1/auth/oauth/google`);
    }
  });
});
