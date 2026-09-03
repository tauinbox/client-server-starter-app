import {
  expect,
  loginViaUi,
  routeApiToMockServer,
  test
} from '../fixtures/base.fixture';

// A second browser context is a second device: it has its own cookie jar, so
// the two sessions are independent the way a phone and a laptop are. A second
// tab of the same context would share the refresh cookie and prove nothing.
test.describe('Per-device logout', () => {
  test('signing out on one device leaves the other device signed in', async ({
    _mockServer,
    browser,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    const otherDevice = await browser.newContext();
    const otherPage = await otherDevice.newPage();
    await routeApiToMockServer(otherPage, _mockServer.url);
    await loginViaUi(otherPage, _mockServer.url, { roles: ['admin'] });

    const bothSignedIn = await _mockServer.getState();
    expect(bothSignedIn.refreshTokens).toBe(2);

    await page.getByRole('button', { name: /John Doe/i }).click();
    await page.getByRole('menuitem', { name: /Logout/i }).click();
    await expect(page).toHaveURL(/\/login\b/);

    const afterLogout = await _mockServer.getState();
    expect(afterLogout.refreshTokens).toBe(1);

    // The other device keeps its access token and its refresh cookie. A
    // reload proves both: the page restores the session and the API answers.
    await otherPage.reload();
    await expect(
      otherPage.getByRole('button', { name: /John Doe/i })
    ).toBeVisible();
    await expect(otherPage).toHaveURL(/\/profile\b/);

    await otherDevice.close();
  });
});
