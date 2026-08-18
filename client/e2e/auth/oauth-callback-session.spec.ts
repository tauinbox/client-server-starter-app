import { expect, test } from '../fixtures/base.fixture';
import type { UserResponse } from '@app/shared/types';
import type { Page, BrowserContext } from '@playwright/test';
import type { MockServerApi } from '../fixtures/base.fixture';

/**
 * Regression: the OAuth callback used to save the tokens and navigate, without
 * running the rest of the post-login routine. The CASL ability stayed empty,
 * and `permissionGuard` denies without issuing a request — so an OAuth
 * sign-in bounced an admin from every guarded route to /forbidden.
 *
 * The provider round trip needs a real identity provider, so these tests start
 * where the browser comes back: holding the `oauth_data` cookie the provider
 * callback would have set, minted here by the mock control plane.
 */
async function arriveAtCallback(
  page: Page,
  context: BrowserContext,
  mockServer: MockServerApi,
  returnUrl?: string
): Promise<void> {
  const state = await mockServer.getState();
  const admin = (state.users as UserResponse[]).find(
    (u) => u.email === 'admin@example.com'
  );
  expect(admin).toBeDefined();

  const { token } = await mockServer.issueOAuthData(admin!.id);

  await page.goto('/login');
  if (returnUrl) {
    // What the login page stores before handing the browser to the provider.
    await page.evaluate(
      (url) => sessionStorage.setItem('oauth_return_url', JSON.stringify(url)),
      returnUrl
    );
  }

  await context.addCookies([
    {
      name: 'oauth_data',
      value: token,
      url: `${new URL(page.url()).origin}/api/v1/auth/oauth`
    }
  ]);

  await page.goto('/oauth/callback');
}

test.describe('OAuth sign-in — completed session', () => {
  test('lands on a permission-guarded return URL instead of /forbidden', async ({
    _mockServer,
    page,
    context
  }) => {
    await arriveAtCallback(page, context, _mockServer, '/admin/users');

    await expect(page).toHaveURL(/\/admin\/users/);
    await expect(page.locator('table')).toBeVisible();
  });

  test('populates the ability, so permission-gated content renders', async ({
    _mockServer,
    page,
    context
  }) => {
    await arriveAtCallback(page, context, _mockServer);

    // No return URL stored — the callback falls back to /profile.
    await expect(page).toHaveURL(/\/profile/);

    // The sidenav entry is computed from the ability (canAccessAdminPanel), so
    // it is absent for as long as the rules are missing. Asserted without a
    // reload on purpose: a reload re-runs the bootstrap initializer, which
    // loads the permissions the callback skipped and masks the defect.
    const adminLink = page.locator('a.nav-link[aria-label="Admin Panel"]');
    await expect(adminLink).toBeVisible();

    // In-app navigation, so the guard evaluates against the same live ability.
    await adminLink.click();
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.locator('a[mat-tab-link]').first()).toBeVisible();
  });
});
