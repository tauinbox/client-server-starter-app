import {
  expect,
  expectNoSnackbar,
  loginViaUi,
  openedDialog,
  test
} from '../fixtures/base.fixture';
import { mockId } from '../fixtures/ids';

// A rejected save must leave the edit on screen, because a rule set or a long
// description can take minutes to build.
test.describe('Admin form dialogs keep the input when the save fails', () => {
  test('a version conflict keeps the flag dialog open with the edit and the reason', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/feature-flags');

    await page
      .getByRole('row', { name: /beta-export/ })
      .getByRole('button', { name: /Edit flag beta-export/ })
      .click();
    const dialog = await openedDialog(page);

    const description = dialog.getByLabel('Description');
    await description.fill('Rolled out to the beta group');
    await dialog.getByRole('button', { name: 'Add rule' }).click();
    await dialog.getByRole('button', { name: 'Add rule' }).click();
    const ruleRows = dialog.locator('nxs-feature-flag-rule-row');
    await expect(ruleRows).toHaveCount(3);

    let patches = 0;
    await page.route('**/api/v1/admin/feature-flags/*', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.fallback();
        return;
      }
      patches++;
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 409,
          message: 'Feature flag was modified by another request',
          errorKey: 'errors.featureFlags.versionConflict'
        })
      });
    });

    await dialog.getByRole('button', { name: 'Save' }).click();

    const alert = dialog.getByRole('alert');
    await expect(alert).toHaveText(
      'Feature flag was modified by another request. Reload and retry.'
    );
    // The line sits below the rule rows, so the dialog has to scroll to it.
    await expect(alert).toBeInViewport();
    await expectNoSnackbar(page);
    expect(patches).toBe(1);
    await expect(dialog).toBeVisible();
    await expect(description).toHaveValue('Rolled out to the beta group');
    await expect(ruleRows).toHaveCount(3);
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  test('after a version conflict the reopened flag dialog saves with the current version', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/feature-flags');
    const row = page.getByRole('row', { name: /new-dashboard/ });
    await expect(row).toBeVisible();

    // A second admin changes the flag after the list was loaded.
    const login = await fetch(`${_mockServer.url}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'Password1'
      })
    });
    const { tokens } = (await login.json()) as {
      tokens: { access_token: string };
    };
    const otherPatch = await fetch(
      `${_mockServer.url}/api/v1/admin/feature-flags/${mockId('flag-new-dashboard')}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json',
          'If-Match': '1'
        },
        body: JSON.stringify({ description: 'Changed by another admin' })
      }
    );
    expect(otherPatch.status).toBe(200);

    const editButton = row.getByRole('button', {
      name: /Edit flag new-dashboard/
    });
    await editButton.click();
    const dialog = await openedDialog(page);
    await dialog.getByLabel('Description').fill('Stale edit');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Feature flag was modified by another request. Reload and retry.'
    );
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await editButton.click();
    const reopened = await openedDialog(page);
    const description = reopened.getByLabel('Description');
    await expect(description).toHaveValue('Changed by another admin');
    await description.fill('Edit on the current version');
    const save = page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        r.url().includes('/api/v1/admin/feature-flags/')
    );
    await reopened.getByRole('button', { name: 'Save' }).click();
    expect((await save).status()).toBe(200);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row).toContainText('Edit on the current version');
  });

  test('a duplicate role name keeps the role dialog open with the edit and the reason', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/roles');

    await page.getByRole('button', { name: 'Edit role editor' }).click();
    const dialog = await openedDialog(page);

    const name = dialog.getByLabel('Name');
    await name.fill('moderator');
    await dialog.getByLabel('Description').fill('Edits and moderates content');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(dialog.getByRole('alert')).toHaveText(
      'Role with this name already exists'
    );
    await expectNoSnackbar(page);
    await expect(dialog).toBeVisible();
    await expect(name).toHaveValue('moderator');
    await expect(dialog.getByLabel('Description')).toHaveValue(
      'Edits and moderates content'
    );
  });

  test('a rejected resource save is reported once, inside the dialog', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/admin/resources');

    await page.getByRole('button', { name: 'Edit resource Users' }).click();
    const dialog = await openedDialog(page);
    await dialog.getByLabel('Display name').fill('People');

    await page.route('**/api/v1/rbac/resources/*', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 404,
          message: 'Resource not found',
          errorKey: 'errors.rbac.resourceNotFound'
        })
      });
    });

    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(dialog.getByRole('alert')).toBeVisible();
    await expectNoSnackbar(page);
    await expect(dialog.getByLabel('Display name')).toHaveValue('People');
  });
});
