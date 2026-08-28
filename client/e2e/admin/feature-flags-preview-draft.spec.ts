import {
  expect,
  loginViaUi,
  openedDialog,
  test
} from '../fixtures/base.fixture';
import { mockId } from '../fixtures/ids';

type PreviewBody = {
  roles?: string[];
  enabled?: boolean;
  environments?: string[];
  rules?: { type: string; effect: string; payload: { type: string } }[];
};

test.describe('Feature flag preview — unsaved editor state', () => {
  test('preview evaluates the rules in the editor, not the saved ones', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: mockId('user-100'),
      email: 'previewadmin@example.com',
      roles: ['admin']
    });

    await page.goto('/admin/feature-flags');

    // beta-export is seeded enabled with a single 10% percentage rule. A
    // percentage rule cannot match a context without a user, so the saved flag
    // previews as off.
    await page
      .getByRole('row', { name: /beta-export/ })
      .getByRole('button', { name: /Edit flag beta-export/ })
      .click();

    const dialog = await openedDialog(page);
    await dialog.getByRole('button', { name: 'Preview' }).click();

    const previewResult = dialog.locator('.preview-result');
    const runButton = dialog.getByRole('button', { name: 'Run preview' });

    const rolesInput = dialog.getByRole('combobox', { name: 'Roles' });
    await rolesInput.fill('user');
    await rolesInput.press('Enter');
    await expect(
      dialog.locator('.preview-panel').getByRole('row', {
        name: /^user/i
      })
    ).toBeVisible();

    const savedRun = page.waitForResponse(
      (r) =>
        /\/preview$/.test(r.url()) &&
        r.request().method() === 'POST' &&
        r.status() === 200
    );
    await runButton.click();
    const savedBody = (await (
      await savedRun
    )
      .request()
      .postDataJSON()) as PreviewBody;
    expect(savedBody.rules).toHaveLength(1);
    expect(savedBody.rules?.[0].payload.type).toBe('percentage');
    await expect(previewResult).toContainText('Disabled');
    await expect(previewResult).toContainText('No rule matched');

    // Swap the rule to a role rule that matches the synthetic context. Nothing
    // is saved — only the editor changes.
    const ruleRow = dialog.locator('nxs-feature-flag-rule-row').first();
    await ruleRow.getByRole('combobox', { name: 'Type' }).click();
    await page.getByRole('option', { name: 'Role', exact: true }).click();
    const ruleRoleInput = ruleRow.getByRole('combobox', { name: 'Role names' });
    await ruleRoleInput.click();
    await ruleRoleInput.fill('user');
    await page
      .getByRole('option')
      .filter({ hasText: /^user/i })
      .first()
      .click();
    await expect(ruleRow.getByRole('row', { name: /^user/i })).toBeVisible();

    const draftRun = page.waitForResponse(
      (r) =>
        /\/preview$/.test(r.url()) &&
        r.request().method() === 'POST' &&
        r.status() === 200
    );
    await runButton.click();
    const draftBody = (await (
      await draftRun
    )
      .request()
      .postDataJSON()) as PreviewBody;
    expect(draftBody.rules).toHaveLength(1);
    expect(draftBody.rules?.[0].payload.type).toBe('role');
    await expect(previewResult).toContainText('Enabled');
    await expect(previewResult).toContainText('Included by rule');

    // The unsaved "Enabled" switch is carried too.
    await dialog.getByRole('checkbox', { name: 'Enabled' }).click();
    const disabledRun = page.waitForResponse(
      (r) =>
        /\/preview$/.test(r.url()) &&
        r.request().method() === 'POST' &&
        r.status() === 200
    );
    await runButton.click();
    const disabledBody = (await (
      await disabledRun
    )
      .request()
      .postDataJSON()) as PreviewBody;
    expect(disabledBody.enabled).toBe(false);
    await expect(previewResult).toContainText('Flag is turned off');

    // Preview writes nothing: cancel, reopen, and the saved percentage rule is
    // still there.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page
      .getByRole('row', { name: /beta-export/ })
      .getByRole('button', { name: /Edit flag beta-export/ })
      .click();
    const reopened = await openedDialog(page);
    await expect(
      reopened
        .locator('nxs-feature-flag-rule-row')
        .first()
        .getByRole('combobox', { name: 'Type' })
    ).toContainText('Percentage');
  });
});
