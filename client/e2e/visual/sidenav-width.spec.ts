import { expect, loginViaUi, test } from '../fixtures/base.fixture';
import type { Page } from '@playwright/test';

// An undeclared `--nav-width-*` custom property makes the service's
// `style.width = 'var(--nav-width-narrow)'` an invalid declaration: the drawer
// silently falls back to `auto` and the content offset disappears. Unit tests
// cannot see it - global styles are not loaded there.

const NARROW_PX = 64;
const WIDE_PX = 220;

const widthOf = async (page: Page, selector: string): Promise<number> => {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error(`Not visible: ${selector}`);
  return box.width;
};

const marginLeftOf = (page: Page, selector: string): Promise<number> =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el === null) throw new Error(`Selector not found: ${s}`);
    return parseFloat(getComputedStyle(el).marginLeft);
  }, selector);

// Rail width and content offset are transitioned over 300ms, so a bare read can
// land mid-animation. Poll to the settled value, to within a subpixel.
const expectSettled = async (
  measure: () => Promise<number>,
  expected: number
): Promise<void> => {
  await expect.poll(measure).toBeCloseTo(expected, 0);
};

test.describe('Sidenav width tokens', () => {
  test('narrow rail and content offset both resolve to the token width', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    await expect(page.locator('mat-sidenav')).toBeVisible();

    await expectSettled(() => widthOf(page, 'mat-sidenav'), NARROW_PX);
    await expectSettled(() => widthOf(page, '.nav-container'), NARROW_PX);
    await expectSettled(
      () => marginLeftOf(page, 'mat-sidenav-content'),
      NARROW_PX
    );
  });

  test('expanding switches every consumer to the wide token', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    await page.getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByRole('button', { name: 'Collapse' })).toBeVisible();

    await expectSettled(() => widthOf(page, '.nav-container'), WIDE_PX);
    await expectSettled(() => widthOf(page, 'mat-sidenav'), WIDE_PX);
    await expectSettled(
      () => marginLeftOf(page, 'mat-sidenav-content'),
      WIDE_PX
    );
  });
});
