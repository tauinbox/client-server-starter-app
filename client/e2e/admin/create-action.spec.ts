import {
  expect,
  loginViaUi,
  openedDialog,
  test
} from '../fixtures/base.fixture';
import { mockId } from '../fixtures/ids';

const pages = [
  { path: '/admin/roles', label: 'New role', dialogTitle: 'Create role' },
  {
    path: '/admin/feature-flags',
    label: 'New flag',
    dialogTitle: 'Create feature flag'
  }
];

/**
 * Every list page offers its create action the same way: "New <entity>" in the
 * card header, and an extended FAB on a handset.
 */
test.describe('the create action of a list page', () => {
  for (const { path, label, dialogTitle } of pages) {
    test(`${path} shows "${label}" in the header and as a FAB on a handset`, async ({
      _mockServer,
      page
    }) => {
      await loginViaUi(page, _mockServer.url, {
        id: mockId('user-100'),
        email: 'createaction@example.com',
        roles: ['admin']
      });
      await page.goto(path);

      const header = page.locator('mat-card-header');
      const button = header.getByRole('button', { name: label, exact: true });
      await expect(button).toBeVisible();
      await expect(page.locator('.create-fab')).toHaveCount(0);

      await button.click();
      const dialog = await openedDialog(page);
      await expect(
        dialog.getByRole('heading', { name: dialogTitle })
      ).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();

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

      await page.setViewportSize({ width: 375, height: 800 });
      const fab = page.locator('.create-fab');
      await expect(fab).toBeVisible();
      await expect(fab).toHaveAccessibleName(label);
      await expect(
        header.locator('button:not(.create-fab)', { hasText: label })
      ).toHaveCount(0);
      // The card keeps room for the FAB, so the end of the list scrolls clear.
      const cardContent = page.locator('mat-card-content').first();
      const contentBottom = await cardContent.evaluate((el) => {
        let scroller = el.parentElement;
        while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
          scroller = scroller.parentElement;
        }
        scroller?.scrollTo(0, scroller.scrollHeight);
        return el.getBoundingClientRect().bottom;
      });
      const fabTop = (await fab.boundingBox())!.y;
      expect(contentBottom).toBeLessThanOrEqual(fabTop);

      await fab.click();
      await expect(
        (await openedDialog(page)).getByRole('heading', { name: dialogTitle })
      ).toBeVisible();
    });
  }
});
