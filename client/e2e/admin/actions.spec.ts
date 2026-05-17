import { expect, loginViaUi, test } from '../fixtures/base.fixture';

test.describe('Admin Actions page', () => {
  test('should display "Actions" heading', async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/actions');

    await expect(
      page.locator('mat-card-title', { hasText: 'Actions' })
    ).toBeVisible();
  });

  test('should display actions table with correct columns', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/actions');

    // Wait for table to render
    await expect(page.locator('table tbody tr').first()).toBeVisible();

    await expect(
      page.getByRole('columnheader', { name: 'Display Name', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Name', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Default', exact: true })
    ).toBeVisible();
  });

  test('should open Add Action dialog when Add button is clicked', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/actions');

    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // Dialog must open — this would fail with NG0201 if viewContainerRef is missing
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Add Action' })
    ).toBeVisible();
  });

  test('should close Add Action dialog on Cancel', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/actions');

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('should open Edit Action dialog when edit button is clicked', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/actions');

    await expect(page.locator('table tbody tr').first()).toBeVisible();

    // Click the first visible edit button
    await page
      .getByRole('button', { name: /^Edit Action / })
      .first()
      .click();

    // Dialog must open — this would fail with NG0201 if viewContainerRef is missing
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Edit Action' })
    ).toBeVisible();
  });

  test('should create new action and show success notification', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/actions');

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel('Internal Name').fill('publish');
    await page.getByLabel('Display Name').fill('Publish');

    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Add', exact: true })
      .click();

    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('mat-snack-bar-container')).toBeVisible();
  });
});
