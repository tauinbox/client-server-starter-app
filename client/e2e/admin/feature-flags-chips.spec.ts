import { expect, loginViaUi, test } from '../fixtures/base.fixture';

test.describe('Feature flag form — chip+autocomplete inputs (FF-UX-001)', () => {
  test('Environments and role-rule chips persist a created flag', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: '100',
      email: 'chipsadmin@example.com',
      roles: ['admin']
    });

    await page.goto('/admin/feature-flags');
    await page.getByRole('button', { name: /^New flag$/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('textbox', { name: 'Key' }).fill('chips-rollout');

    // Environments — chip-grid combobox accepts free text via Enter
    const envInput = dialog.getByRole('combobox', { name: /Environments/i });
    await envInput.fill('production');
    await envInput.press('Enter');
    // Wait for the chip before typing the next value: a second token-end racing
    // the first one can clobber it (both build on the same stale selected list)
    await expect(
      dialog.getByRole('row', { name: /production/i })
    ).toBeVisible();
    await envInput.fill('qa-eu');
    await envInput.press('Enter');
    await expect(dialog.getByRole('row', { name: /qa-eu/i })).toBeVisible();
    // Dismiss any lingering autocomplete overlay before clicking outside controls
    await envInput.press('Escape');

    // Add a role rule
    await dialog.getByRole('button', { name: 'Add rule' }).click();
    const ruleRow = dialog.locator('nxs-feature-flag-rule-row').first();

    await ruleRow.getByRole('combobox', { name: 'Type' }).click();
    await page.getByRole('option', { name: 'Role', exact: true }).click();

    // Roles are loaded via RoleService.getAll() on init; wait for option to appear
    const roleInput = ruleRow.getByRole('combobox', { name: 'Role names' });
    await roleInput.click();
    await roleInput.fill('user');
    await page
      .getByRole('option')
      .filter({ hasText: /^user/i })
      .first()
      .click();
    await expect(ruleRow.getByRole('row', { name: /^user/i })).toBeVisible();

    const createResp = page.waitForResponse(
      (r) =>
        /\/api\/v1\/admin\/feature-flags$/.test(r.url()) &&
        r.request().method() === 'POST' &&
        r.status() === 201
    );
    const rulesResp = page.waitForResponse(
      (r) =>
        /\/api\/v1\/admin\/feature-flags\/[^/]+\/rules$/.test(r.url()) &&
        r.request().method() === 'PUT'
    );

    await dialog.getByRole('button', { name: /^Create$/ }).click();

    const created = (await (await createResp).json()) as {
      environments: string[];
      key: string;
    };
    expect(created.key).toBe('chips-rollout');
    expect(created.environments.sort()).toEqual(['production', 'qa-eu']);

    const rulesBody = (await (await rulesResp).request().postDataJSON()) as {
      rules: {
        type: string;
        payload: { type: string; roleNames?: string[] };
      }[];
    };
    expect(rulesBody.rules).toHaveLength(1);
    expect(rulesBody.rules[0].type).toBe('role');
    expect(rulesBody.rules[0].payload.roleNames).toEqual(['user']);
  });
});
