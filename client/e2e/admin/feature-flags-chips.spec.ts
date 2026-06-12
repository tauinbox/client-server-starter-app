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

    // Environments — chip-grid combobox accepts free text via Enter.
    // Focus can be stolen between fill()'s internal focus and text insertion
    // (observed in CI: the filled text landed in the Key field while the chip
    // input stayed empty), so verify the value reached the chip input before
    // committing with Enter, and retry the whole add if it leaked elsewhere.
    // Retrying is safe: the chip component ignores duplicate values, and
    // waiting for the chip row also serializes the adds (a second token-end
    // racing the first can clobber it — both build on the same stale list).
    const envInput = dialog.getByRole('combobox', { name: /Environments/i });
    const addEnvironment = async (env: string) => {
      await expect(async () => {
        await envInput.fill(env);
        await expect(envInput).toHaveValue(env, { timeout: 1000 });
        await envInput.press('Enter');
        await expect(dialog.getByRole('row', { name: env })).toBeVisible({
          timeout: 2000
        });
      }).toPass({ timeout: 15_000 });
    };
    await addEnvironment('production');
    await addEnvironment('qa-eu');
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

    // Fill Key last: it is the dialog's first tabbable element, so text leaked
    // by a focus steal during the chip interactions lands here — an
    // authoritative fill now overwrites anything that may have leaked.
    const keyInput = dialog.getByRole('textbox', { name: 'Key' });
    await keyInput.fill('chips-rollout');
    await expect(keyInput).toHaveValue('chips-rollout');

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
