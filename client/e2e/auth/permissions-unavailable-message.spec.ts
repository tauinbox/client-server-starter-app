import { expect, loginViaUi, test } from '../fixtures/base.fixture';

// On a page reload the permissions load runs in an app initializer, before
// the root translation file arrives, so an early translate() answers with the
// key itself. Delaying that file makes the window wide enough to assert on.
test.describe('Permissions load failure on a reload', () => {
  test('explains the restricted access in words, not as a key', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);

    await page.route('**/api/v1/auth/permissions', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({})
      })
    );
    await page.route(/assets\/i18n\/en\.json/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });

    await page.reload();

    const snackbar = page.locator('mat-snack-bar-container');

    await expect(snackbar).toContainText('Permissions could not be loaded', {
      timeout: 10_000
    });
    await expect(snackbar).toContainText('Close');
    await expect(
      page.getByText('errors.general.permissionsUnavailable')
    ).toHaveCount(0);
  });
});
