import type { BrowserContext, Page } from '@playwright/test';
import {
  expect,
  loginViaUi,
  routeApiToMockServer,
  test
} from '../fixtures/base.fixture';

// The cookie-jar-and-rotation contract of reuse detection, through the browser.

async function refreshInPage(page: Page): Promise<number> {
  return page.evaluate(() =>
    fetch('/api/v1/auth/refresh-token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }).then((r) => r.status)
  );
}

async function refreshCookieValue(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies()).find(
    (c) => c.name === 'refresh_token'
  );
  expect(cookie, 'refresh_token cookie should be set').toBeDefined();
  return cookie!.value;
}

async function setRefreshCookie(
  context: BrowserContext,
  value: string
): Promise<void> {
  const current = (await context.cookies()).find(
    (c) => c.name === 'refresh_token'
  );
  expect(current).toBeDefined();
  await context.clearCookies({ name: 'refresh_token' });
  await context.addCookies([{ ...current!, value }]);
}

test.describe('Refresh-token reuse detection', () => {
  test('replaying a rotated token after its successor was used revokes ALL sessions', async ({
    _mockServer,
    page,
    context
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['user'] });
    const original = await refreshCookieValue(context);

    // Using the successor first makes the replay the theft shape, not a lost
    // response.
    expect(await refreshInPage(page)).toBe(200);
    expect(await refreshInPage(page)).toBe(200);
    const latest = await refreshCookieValue(context);
    expect(latest).not.toBe(original);

    await setRefreshCookie(context, original);
    expect(await refreshInPage(page)).toBe(401);

    // The newest token of the legitimate client must be dead too: the replay
    // ended every session of the user, not only its own chain.
    await setRefreshCookie(context, latest);
    expect(await refreshInPage(page)).toBe(401);
  });

  test('a rotation response that never reaches the browser signs out only that device', async ({
    _mockServer,
    browser,
    page,
    context
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['user'] });

    const otherDevice = await browser.newContext();
    const otherPage = await otherDevice.newPage();
    await routeApiToMockServer(otherPage, _mockServer.url);
    await loginViaUi(otherPage, _mockServer.url, { roles: ['user'] });

    const before = await refreshCookieValue(context);

    // Forwarded from Node, so the server rotates but the jar never receives
    // the successor: the effect of a lost response.
    await page.route(
      /\/api\/v1\/auth\/refresh-token/,
      async (route) => {
        const rotated = await fetch(
          `${_mockServer.url}/api/v1/auth/refresh-token`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              cookie: `refresh_token=${before}`
            },
            body: '{}'
          }
        );
        expect(rotated.status).toBe(200);
        await route.fulfill({
          status: rotated.status,
          contentType: 'application/json',
          body: await rotated.text()
        });
      },
      { times: 1 }
    );
    await page.reload();
    await expect(page).toHaveURL(/\/profile\b/);
    expect(await refreshCookieValue(context)).toBe(before);

    await page.reload();
    await expect(page).toHaveURL(/\/login\b/);

    // The URL reads /profile before the bootstrap refresh settles, so the
    // user menu is the proof that the session survived.
    await otherPage.reload();
    await expect(
      otherPage.getByRole('button', { name: /John Doe/i })
    ).toBeVisible();
    await expect(otherPage).toHaveURL(/\/profile\b/);

    expect((await _mockServer.getState()).refreshTokens).toBe(1);

    await otherDevice.close();
  });
});
