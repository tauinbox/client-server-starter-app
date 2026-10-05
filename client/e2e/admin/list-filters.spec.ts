import {
  expect,
  listResponse,
  loginViaUi,
  test
} from '../fixtures/base.fixture';

// The admin lists share one search-and-filter bar: the search applies after a
// pause in typing, a select at once, and neither has a button. A select opens
// through its combobox role: while a closed panel animates out, the label
// also names that listbox.

test.describe('Admin list search and filters', () => {
  test.beforeEach(async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
  });

  test('feature flags: search, status and environment narrow the list', async ({
    page
  }) => {
    const path = '/api/v1/admin/feature-flags/cursor';
    await page.goto('/admin/feature-flags');
    await expect(page.getByText('new-dashboard')).toBeVisible();

    const searched = listResponse(page, path, { q: 'dashboard' });
    await page.getByLabel('Search').fill('dashboard');
    await searched;
    await expect(page.getByText('new-dashboard')).toBeVisible();
    await expect(page.getByText('beta-export')).toBeHidden();

    const disabled = listResponse(page, path, {
      q: 'dashboard',
      enabled: 'false'
    });
    await page.getByRole('combobox', { name: 'Status' }).click();
    await page.getByRole('option', { name: 'Disabled' }).click();
    await disabled;
    await expect(page.getByText('new-dashboard')).toBeVisible();

    // The seeded flags list no environment, so they apply in every one.
    const staging = listResponse(page, path, { environment: 'staging' });
    await page.getByRole('combobox', { name: 'Environments' }).click();
    await page.getByRole('option', { name: 'staging' }).click();
    await staging;
    await expect(page.getByText('new-dashboard')).toBeVisible();

    const enabled = listResponse(page, path, { enabled: 'true' });
    await page.getByRole('combobox', { name: 'Status' }).click();
    await page.getByRole('option', { name: 'Enabled' }).click();
    await enabled;
    await expect(
      page.getByText('Nothing matches these filters.')
    ).toBeVisible();
  });

  test('roles: the type select and the search narrow the list', async ({
    page
  }) => {
    const path = '/api/v1/roles/cursor';
    const editor = page.getByRole('cell', { name: 'editor', exact: true });
    await page.goto('/admin/roles');
    await expect(editor).toBeVisible();

    const custom = listResponse(page, path, { isSystem: 'false' });
    await page.getByRole('combobox', { name: 'Type' }).click();
    await page.getByRole('option', { name: 'Custom' }).click();
    await custom;
    await expect(editor).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'admin', exact: true })
    ).toBeHidden();

    const none = listResponse(page, path, {
      isSystem: 'false',
      q: 'no-such-role'
    });
    await page.getByLabel('Search').fill('no-such-role');
    await none;
    await expect(
      page.getByText('Nothing matches these filters.')
    ).toBeVisible();
  });

  test('resources: the status select sends isOrphaned', async ({ page }) => {
    const path = '/api/v1/rbac/resources/cursor';
    await page.goto('/admin/resources');
    await expect(page.locator('table tbody tr').first()).toBeVisible();

    const orphaned = listResponse(page, path, { isOrphaned: 'true' });
    await page.getByRole('combobox', { name: 'Status' }).click();
    await page.getByRole('option', { name: 'Orphaned' }).click();
    await orphaned;

    // The mock seeds no orphaned resource.
    await expect(
      page.getByText('Nothing matches these filters.')
    ).toBeVisible();

    const active = listResponse(page, path, { isOrphaned: 'false' });
    await page.getByRole('combobox', { name: 'Status' }).click();
    await page.getByRole('option', { name: 'Active' }).click();
    await active;
    await expect(page.locator('table tbody tr').first()).toBeVisible();
  });
});
