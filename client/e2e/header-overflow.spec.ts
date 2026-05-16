import { expect, loginViaUi, test } from './fixtures/base.fixture';
import type { Page } from '@playwright/test';

// BKL-032 regression: at handset widths (≤599px) no descendant of the
// top toolbar may extend past the viewport's right edge. The original
// failure mode was the "Register" / "Регистрация" button being pushed
// 24-35px off-screen at 320×568 because the brand text consumed 120px.
const HANDSET_WIDTHS = [320, 360, 375, 414] as const;
const HANDSET_HEIGHT = 700;

async function assertHeaderFitsViewport(
  page: Page,
  viewportWidth: number
): Promise<void> {
  const items = page.locator('mat-toolbar > *');
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    if (!(await item.isVisible())) continue;
    const box = await item.boundingBox();
    if (!box) continue;
    const right = box.x + box.width;
    const tag = await item.evaluate((el) => el.tagName.toLowerCase());
    expect(
      right,
      `Header child #${i} (${tag}) right edge ${right}px must not exceed viewport ${viewportWidth}px`
    ).toBeLessThanOrEqual(viewportWidth + 0.5);
  }
}

test.describe('Header — handset overflow regression (BKL-032)', () => {
  for (const lang of ['en', 'ru'] as const) {
    for (const width of HANDSET_WIDTHS) {
      test(`anonymous /login at ${width}px (${lang}) keeps all header items within viewport`, async ({
        page
      }) => {
        await page.addInitScript((l) => {
          window.localStorage.setItem('preferred-language', l);
        }, lang);
        await page.setViewportSize({ width, height: HANDSET_HEIGHT });
        await page.goto('/login');
        await expect(page.locator('mat-toolbar')).toBeVisible();

        await assertHeaderFitsViewport(page, width);
      });
    }
  }

  for (const width of HANDSET_WIDTHS) {
    test(`authenticated /profile at ${width}px keeps header items within viewport even with long user name`, async ({
      _mockServer,
      page
    }) => {
      await page.setViewportSize({ width, height: HANDSET_HEIGHT });
      // Long names worst-case scenario: the user-menu button is the widest
      // element on the authenticated header. Pre-fix, "Admin User" alone
      // pushed scrollWidth to 336 at 320×568.
      await loginViaUi(page, _mockServer.url, {
        firstName: 'Александр',
        lastName: 'Тупавов'
      });
      await expect(page.locator('mat-toolbar')).toBeVisible();

      await assertHeaderFitsViewport(page, width);
    });
  }

  test('brand text is visible at desktop width (>= 600px)', async ({
    page
  }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto('/login');
    await expect(page.locator('mat-toolbar > span.app-brand')).toBeVisible();
  });

  test('brand text is hidden at handset width (<= 599px)', async ({ page }) => {
    await page.setViewportSize({ width: 599, height: 800 });
    await page.goto('/login');
    await expect(page.locator('mat-toolbar > span.app-brand')).toBeHidden();
  });
});
