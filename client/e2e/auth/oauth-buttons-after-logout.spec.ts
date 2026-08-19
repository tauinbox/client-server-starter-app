import { expect, loginViaUi, test } from '../fixtures/base.fixture';

// The session teardown empties the feature-flag store and every provider
// button is gated on a flag, so the login page it navigates to used to render
// without buttons until a full page reload.
test.describe('OAuth buttons after logout', () => {
  test('the login page still offers the providers after logging out', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['user'] });

    await page.getByRole('button', { name: /John Doe/i }).click();
    await page.getByRole('menuitem', { name: /Logout/i }).click();
    await expect(page).toHaveURL(/\/login\b/);

    // Same document as the logout: no reload, which is what used to be needed.
    await expect(page.locator('.oauth-divider')).toBeVisible();
    await expect(page.locator('.oauth-button')).toHaveCount(3);
  });
});
