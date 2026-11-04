import { expect, loginViaUi, test } from '../fixtures/base.fixture';

// The filter bar is a shared component: it translates the scoped keys that
// the page gives it, but it does not load the scope itself. The first switch
// to a language must still show translated labels when the scope file
// arrives after the root file.

test.describe('First language switch on a list page', () => {
  test.beforeEach(async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
  });

  test('the filter bar shows the scoped labels in the new language', async ({
    page
  }) => {
    const rootLoaded = page.waitForResponse(/\/assets\/i18n\/ru\.json$/);
    await page.route(/\/features\/users\/i18n\/ru\.json$/, async (route) => {
      await rootLoaded;
      await route.continue();
    });

    await page.goto('/users');
    await expect(page.getByLabel('Search')).toBeVisible();

    await page.getByRole('button', { name: 'Switch language' }).click();
    await page.getByRole('menuitem', { name: 'Русский' }).click();

    await expect(page.getByLabel('Поиск')).toBeVisible();
    await expect(page.getByText('Показывать удалённых')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('users.list.');
  });
});
