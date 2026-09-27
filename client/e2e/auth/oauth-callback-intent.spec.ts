import { expect, test } from '../fixtures/base.fixture';
import type { UserResponse } from '@app/shared/types';
import type { BrowserContext, Page } from '@playwright/test';
import type { MockServerApi } from '../fixtures/base.fixture';

/**
 * Any page can send a browser to the provider start route, and a provider that
 * already has consent returns without a screen. The callback must then finish
 * nothing, because this tab did not start the round trip. The provider leg
 * needs a real identity provider, so these tests start where the browser comes
 * back: holding the `oauth_data` cookie, minted by the mock control plane.
 */
async function holdOAuthData(
  page: Page,
  context: BrowserContext,
  mockServer: MockServerApi
): Promise<void> {
  const state = await mockServer.getState();
  const admin = (state.users as UserResponse[]).find(
    (u) => u.email === 'admin@example.com'
  );
  expect(admin).toBeDefined();

  const { token } = await mockServer.issueOAuthData(admin!.id);
  await context.addCookies([
    {
      name: 'oauth_data',
      value: token,
      url: `${new URL(page.url()).origin}/`
    }
  ]);
}

function countExchanges(page: Page): () => number {
  let count = 0;
  page.on('request', (req) => {
    if (req.url().includes('/api/v1/auth/oauth/exchange')) count++;
  });
  return () => count;
}

async function expectSignedOut(page: Page): Promise<void> {
  await page.goto('/profile');
  await expect(page).toHaveURL(/\/login/);
}

test.describe('OAuth callback that this tab did not start', () => {
  test('a round trip started by another page signs nobody in', async ({
    _mockServer,
    page,
    context
  }) => {
    await page.goto('/login');
    await holdOAuthData(page, context, _mockServer);
    const exchanges = countExchanges(page);

    await page.goto('/oauth/callback');

    await expect(page).toHaveURL(/\/login\?oauth_error=auth_failed/);
    expect(exchanges()).toBe(0);
    await expectSignedOut(page);
  });

  test('a proof left by a round trip that ended on another page is dropped', async ({
    _mockServer,
    page,
    context
  }) => {
    await page.goto('/login');
    await page.evaluate(() =>
      sessionStorage.setItem('oauth_return_url', '/profile')
    );
    // The provider refused, so the server sent the browser to /login.
    await page.goto('/login?oauth_error=oauth_cancelled');
    await holdOAuthData(page, context, _mockServer);
    const exchanges = countExchanges(page);

    await page.goto('/oauth/callback');

    await expect(page).toHaveURL(/\/login\?oauth_error=auth_failed/);
    expect(exchanges()).toBe(0);
    await expectSignedOut(page);
  });
});
