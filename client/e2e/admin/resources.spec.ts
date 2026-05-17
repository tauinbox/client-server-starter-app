import {
  expect,
  expectAuthRedirect,
  expectForbiddenRedirect,
  loginViaUi,
  test
} from '../fixtures/base.fixture';

test.describe('Admin Resources page', () => {
  test('should redirect to login when not authenticated', async ({
    _mockServer,
    page
  }) => {
    await expectAuthRedirect(page, '/admin/resources');
  });

  test('should redirect to forbidden when non-admin', async ({
    _mockServer,
    page
  }) => {
    await expectForbiddenRedirect(page, _mockServer.url, '/admin/resources');
  });

  test('should display "Resources" heading', async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/resources');

    await expect(
      page.locator('mat-card-title', { hasText: 'Resources' })
    ).toBeVisible();
  });

  test('should display resources table with correct columns', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/resources');

    // Wait for table to render
    await expect(page.locator('table tbody tr').first()).toBeVisible();

    await expect(
      page.getByRole('columnheader', { name: 'Display Name', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Name', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Subject', exact: true })
    ).toBeVisible();
  });

  test('should open Edit Resource dialog when edit button is clicked', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/resources');

    await expect(page.locator('table tbody tr').first()).toBeVisible();

    // Click the first visible edit button
    await page
      .getByRole('button', { name: /^Edit Resource / })
      .first()
      .click();

    // Dialog must open — this would fail with NG0201 if viewContainerRef is missing
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Edit Resource' })
    ).toBeVisible();
  });

  test('should close Edit Resource dialog on Cancel', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/resources');

    await expect(page.locator('table tbody tr').first()).toBeVisible();
    await page
      .getByRole('button', { name: /^Edit Resource / })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('should save resource changes and show success notification', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/resources');

    await expect(page.locator('table tbody tr').first()).toBeVisible();
    await page
      .getByRole('button', { name: /^Edit Resource / })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const displayNameInput = page.getByLabel('Display Name');
    await displayNameInput.clear();
    await displayNameInput.fill('Updated Resource Name');

    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('mat-snack-bar-container')).toBeVisible();
  });
});
