import {
  expect,
  expectAuthRedirect,
  expectForbiddenRedirect,
  loginViaUi,
  openedDialog,
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

  // The picker offers every action, so it must read the unpaginated catalog:
  // sourcing it from a page of the cursor list drops whatever falls off the
  // first page, and the "Custom" seed then writes an incomplete allowed list.
  test('builds the allowed-actions picker from the full catalog', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    const actionRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/rbac/actions')) {
        actionRequests.push(request.url());
      }
    });

    await page.goto('/admin/resources');
    await expect(page.locator('table tbody tr').first()).toBeVisible();

    // Profile allows only read and update, so the picker opens in custom mode
    // with a partial selection and must still offer every action there is.
    await page.getByRole('button', { name: 'Edit Resource Profile' }).click();
    await openedDialog(page);

    await expect(page.locator('mat-dialog-content mat-checkbox')).toHaveCount(
      6
    );
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(2);
    await expect(page.getByRole('checkbox', { name: 'Read' })).toBeChecked();
    await expect(
      page.getByRole('checkbox', { name: /^Assign/ })
    ).not.toBeChecked();

    expect(actionRequests).toHaveLength(1);
    expect(actionRequests[0]).not.toContain('/cursor');
  });

  // Switching a resource with no explicit list into custom mode seeds it from
  // the default actions, so that seed has to see the whole catalog.
  test('seeds custom mode from every default action', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/resources');
    await expect(page.locator('table tbody tr').first()).toBeVisible();

    // Users has no allowed list, so the dialog opens in default mode.
    await page.getByRole('button', { name: 'Edit Resource Users' }).click();
    await openedDialog(page);

    const customToggle = page.getByRole('switch', { name: 'Custom' });
    await expect(customToggle).toBeEnabled();
    await customToggle.click();
    await expect(customToggle).toBeChecked();

    // The five default actions are pre-selected; the non-default one is not.
    await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(5);
    await expect(
      page.getByRole('checkbox', { name: /^Assign/ })
    ).not.toBeChecked();
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
    await openedDialog(page);

    const displayNameInput = page.getByLabel('Display Name');
    await displayNameInput.clear();
    await displayNameInput.fill('Updated Resource Name');

    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('mat-snack-bar-container')).toBeVisible();
  });
});
