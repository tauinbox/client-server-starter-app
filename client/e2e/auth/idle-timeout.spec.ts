import type { Page } from '@playwright/test';
import {
  expect,
  loginViaUi,
  routeApiToMockServer,
  test
} from '../fixtures/base.fixture';

const IDLE_MESSAGE = 'You were signed out after 30 minutes without activity.';

async function expectSignedOutIdle(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/login\?.*session_ended=idle/);
  await expect(page.getByText(IDLE_MESSAGE)).toBeVisible();
}

// The clock is installed on the context, so every tab of a test shares it and
// a fast-forward moves all of them at once.
test.describe('Idle timeout', () => {
  test('an open tab without input is signed out and the session revoked', async ({
    _mockServer,
    page
  }) => {
    // Before any navigation, so the page still loads on a running clock.
    await page.clock.install();
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    expect((await _mockServer.getState()).refreshTokens).toBe(1);

    await page.clock.fastForward('29:00');
    await expect(page).toHaveURL(/\/profile\b/);

    await page.clock.fastForward('02:00');
    await expectSignedOutIdle(page);

    // Revoked on the server, not only forgotten by the tab.
    await expect
      .poll(async () => (await _mockServer.getState()).refreshTokens)
      .toBe(0);
  });

  test('input in another tab keeps this tab signed in', async ({
    _mockServer,
    page
  }) => {
    await page.clock.install();
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    const otherTab = await page.context().newPage();
    await routeApiToMockServer(otherTab, _mockServer.url);
    await otherTab.goto('/profile');
    await expect(
      otherTab.getByRole('button', { name: /John Doe/i })
    ).toBeVisible();

    await page.clock.fastForward('20:00');
    await otherTab.keyboard.press('Shift');

    // 31 minutes after the sign-in, 11 after the input.
    await page.clock.fastForward('11:00');
    await expect(page).toHaveURL(/\/profile\b/);
    await expect(page.getByRole('button', { name: /John Doe/i })).toBeVisible();

    // And the limit still applies from that input on.
    await page.clock.fastForward('20:00');
    await expectSignedOutIdle(page);
    await otherTab.close();
  });

  test('a tab shown again after the limit signs out at once', async ({
    _mockServer,
    page
  }) => {
    await page.clock.install();
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    // A suspended tab: the time moves and no timer runs. The clock stays paused
    // until the logout is on the wire, so only the visibility check can be the
    // trigger.
    await page.clock.pauseAt(Date.now() + 1000);
    await page.clock.setSystemTime(Date.now() + 31 * 60 * 1000);

    const logout = page.waitForRequest(/\/api\/v1\/auth\/logout$/);
    await page.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange'))
    );
    await logout;

    await page.clock.resume();
    await expectSignedOutIdle(page);
  });
});
