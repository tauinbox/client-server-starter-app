import type { Page } from '@playwright/test';
import {
  expect,
  loginViaUi,
  routeApiToMockServer,
  test
} from '../fixtures/base.fixture';
import { MOCK_TOTP_CODE } from '../../../mock-server/src/constants';

const PASSWORD = 'Password1';

/** Fails the run on a horizontal overflow, at every width and both schemes. */
async function expectNoOverflow(page: Page): Promise<void> {
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [375, 768, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );
      expect(
        overflow,
        `horizontal overflow at ${width}px in ${colorScheme}`
      ).toBeLessThanOrEqual(0);
    }
  }
  await page.setViewportSize({ width: 1366, height: 900 });
}

// A second browser context is a second device, with a cookie jar of its own.
test.describe('Signed-in devices', () => {
  test('ends another device from the profile page', async ({
    _mockServer,
    browser,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    const otherDevice = await browser.newContext();
    const otherPage = await otherDevice.newPage();
    await routeApiToMockServer(otherPage, _mockServer.url);
    await loginViaUi(otherPage, _mockServer.url);

    await page.reload();
    const card = page.locator('nxs-active-sessions');
    await expect(card.locator('.sessions-item')).toHaveCount(2);
    await expect(card.getByText('This device')).toHaveCount(1);

    const other = card
      .locator('.sessions-item')
      .filter({ hasNot: page.locator('.sessions-badge') });
    await other.getByRole('button', { name: 'Sign out' }).click();

    await card.getByLabel('Current password').fill(PASSWORD);
    await expectNoOverflow(page);
    await card
      .locator('.sessions-step-up')
      .getByRole('button', { name: 'Sign out', exact: true })
      .click();

    await expect(
      page.getByText('The device has been signed out')
    ).toBeVisible();
    await expect(card.locator('.sessions-item')).toHaveCount(1);

    // The ended device has neither a working access token nor a refresh
    // cookie, so the next load sends it to the sign-in page.
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/login\b/);

    // The device that ended it stays signed in.
    await page.reload();
    await expect(page).toHaveURL(/\/profile\b/);

    await otherDevice.close();
  });

  test('offers to sign out the other devices after two-factor is turned on', async ({
    _mockServer,
    browser,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    const otherDevice = await browser.newContext();
    const otherPage = await otherDevice.newPage();
    await routeApiToMockServer(otherPage, _mockServer.url);
    await loginViaUi(otherPage, _mockServer.url);

    await page.reload();
    const sessions = page.locator('nxs-active-sessions');
    await expect(sessions.locator('.sessions-item')).toHaveCount(2);
    await expect(sessions.locator('.sessions-offer')).toHaveCount(0);

    const twoFactor = page.locator('nxs-two-factor');
    await twoFactor.getByRole('button', { name: 'Turn on' }).click();
    await twoFactor.getByLabel('Current password').fill(PASSWORD);
    await twoFactor.getByRole('button', { name: 'Continue' }).click();
    await twoFactor.getByLabel('Authentication code').fill(MOCK_TOTP_CODE);
    await twoFactor.getByRole('button', { name: 'Turn on' }).click();
    await twoFactor.getByRole('button', { name: 'I saved them' }).click();

    await expect(sessions.locator('.sessions-offer')).toBeVisible();
    await expectNoOverflow(page);

    await sessions
      .getByRole('button', { name: 'Sign out all other devices' })
      .click();
    await sessions.getByLabel('Current password').fill(PASSWORD);
    await sessions
      .locator('.sessions-step-up')
      .getByRole('button', { name: 'Sign out all other devices' })
      .click();

    await expect(
      page.getByText('All other devices have been signed out')
    ).toBeVisible();
    await expect(sessions.locator('.sessions-item')).toHaveCount(1);
    await expect(sessions.locator('.sessions-offer')).toHaveCount(0);

    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/login\b/);

    await otherDevice.close();
  });
});
