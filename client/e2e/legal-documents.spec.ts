import { expect, test } from './fixtures/base.fixture';

// The production build hides every legal document while its version is a
// draft, so neither the page nor a link can reach a user before the review.
test.describe('Legal documents in a production build', () => {
  test('a draft document is not found and no page links to it', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/legal/ru/privacy');

    await expect(
      page.getByRole('heading', { name: 'Page not found' })
    ).toBeVisible();
    await expect(page.locator('a[href^="/legal/"]')).toHaveCount(0);

    await page.goto('/register');

    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.locator('a[href^="/legal/"]')).toHaveCount(0);
  });
});
