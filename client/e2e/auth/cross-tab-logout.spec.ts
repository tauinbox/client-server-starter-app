import {
  expect,
  loginViaUi,
  routeApiToMockServer,
  test
} from '../fixtures/base.fixture';

// The observing tab parks on /profile deliberately: a list page keeps issuing
// cursor requests, and the first 401 would send the jwt interceptor down the
// forced-logout path on its own, so the tab would reach /login with or without
// the listener. /profile loads once and then goes quiet.
test.describe('Cross-tab logout', () => {
  test('logging out in one tab ends the session in the other', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    const otherTab = await page.context().newPage();
    // Routes are per page, not per context, so the second tab needs its own.
    await routeApiToMockServer(otherTab, _mockServer.url);

    // No access token of its own - it restores the session from the shared
    // refresh cookie.
    await otherTab.goto('/profile');
    await expect(
      otherTab.getByRole('button', { name: /John Doe/i })
    ).toBeVisible();

    await page.getByRole('button', { name: /John Doe/i }).click();
    await page.getByRole('menuitem', { name: /Logout/i }).click();
    await expect(page).toHaveURL(/\/login\b/);

    await expect(otherTab).toHaveURL(/\/login\b/);
    await otherTab.close();
  });

  test('a profile update in another tab leaves this tab signed in', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');
    await expect(page).toHaveURL(/\/users\b/);

    // Saving the profile rewrites the same persisted-user key that a logout
    // removes. The listener keys on the removal only, so a write must leave the
    // observing tab alone.
    const otherTab = await page.context().newPage();
    await routeApiToMockServer(otherTab, _mockServer.url);
    await otherTab.goto('/profile');
    await otherTab.getByLabel('First Name').fill('Renamed');
    await otherTab.getByLabel('First Name').blur();
    await otherTab.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      otherTab.getByRole('button', { name: /Renamed Doe/i })
    ).toBeVisible();

    await expect(page).toHaveURL(/\/users\b/);
    await expect(page.getByRole('button', { name: /John Doe/i })).toBeVisible();
    await otherTab.close();
  });
});
