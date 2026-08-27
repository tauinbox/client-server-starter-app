import {
  expect,
  loginViaUi,
  openedDialog,
  test
} from '../fixtures/base.fixture';
import { mockId } from '../fixtures/ids';

test.describe('Feature flags — admin UX fixes (FF-UX-007 / FF-UX-008)', () => {
  test('FF-UX-007: handset card shows "All environments" when the flag has no environments configured', async ({
    _mockServer,
    page
  }) => {
    // Both seeded flags (new-dashboard, beta-export) have environments: []. On
    // handset, the card should render the "Environments — All environments"
    // dt/dd pair instead of omitting the row entirely.
    await page.setViewportSize({ width: 375, height: 667 });

    await loginViaUi(page, _mockServer.url, {
      id: mockId('user-100'),
      email: 'mobileadmin@example.com',
      roles: ['admin']
    });

    await page.goto('/admin/feature-flags');

    const card = page.locator('.flag-card', { hasText: 'new-dashboard' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Environments');
    await expect(card).toContainText('All environments');
  });

  test('FF-UX-008: rules failure on update shows distinct snackbar and marks the row', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: mockId('user-101'),
      email: 'rulesadmin@example.com',
      roles: ['admin']
    });

    // Force the rules-PUT to fail while letting the flag-PUT succeed. This is
    // the partial-failure pattern the fix is supposed to surface clearly.
    await page.route(
      /\/api\/v1\/admin\/feature-flags\/[^/]+\/rules$/,
      (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 500,
            message: 'Internal Server Error'
          })
        })
    );

    await page.goto('/admin/feature-flags');

    const betaRow = page.getByRole('row', { name: /beta-export/ });
    await betaRow
      .getByRole('button', { name: /Edit flag beta-export/ })
      .click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // beta-export is seeded with one percentage rule — removing it flips
    // rulesChanged to true, so Save triggers a rules PUT (which we've stubbed
    // to 500).
    await dialog.getByRole('button', { name: 'Remove rule' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();

    // Removing the only include rule leaves an enabled flag with no include
    // rules, so saving prompts the "enable for everyone" confirmation.
    await page
      .getByRole('button', { name: 'Confirm' })
      .click({ timeout: 5_000 });

    // Composite outcome: NO "Feature flag updated" success snackbar, only the
    // distinct rules-failure message carrying the flag key and the reason the
    // server gave.
    await expect(
      page.getByText(
        'Flag "beta-export" updated, but the rules did not save. Reopen it to retry. Cause: Internal Server Error'
      )
    ).toBeVisible();

    // Persistent warning marker — survives after the snackbar dismisses.
    await expect(
      page.getByRole('row', { name: /beta-export/ }).locator('.rules-warning')
    ).toBeVisible();
  });

  test('FF-UX-009: editing the value box of a boolean attribute rule leaves the flag on', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: mockId('user-102'),
      email: 'flagvalueadmin@example.com',
      roles: ['admin']
    });

    await page.goto('/admin/feature-flags');

    await page
      .getByRole('row', { name: /oauth-google/ })
      .getByRole('button', { name: /Edit flag oauth-google/ })
      .click();

    const dialog = await openedDialog(page);
    // The seeded rule is `custom oauthGoogleConfigured eq true`. The box is
    // text, so a single keystroke used to store the string "true", which the
    // evaluator compares with === and never matches again.
    const valueInput = dialog.getByRole('textbox', { name: 'Value' });
    await expect(valueInput).toHaveValue('true');
    await valueInput.fill('true');

    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText('Feature flag "oauth-google" updated')
    ).toBeVisible();

    const res = await fetch(`${_mockServer.url}/api/v1/feature-flags`);
    const body = (await res.json()) as { flags: Record<string, boolean> };
    expect(body.flags['oauth-google']).toBe(true);
  });

  test('FF-UX-010: a rule the server would reject blocks the save instead of half-applying it', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: mockId('user-103'),
      email: 'flagpreflightadmin@example.com',
      roles: ['admin']
    });

    await page.goto('/admin/feature-flags');

    await page
      .getByRole('row', { name: /beta-export/ })
      .getByRole('button', { name: /Edit flag beta-export/ })
      .click();

    const dialog = await openedDialog(page);
    const ruleRow = dialog.locator('nxs-feature-flag-rule-row').first();

    await ruleRow.getByRole('combobox', { name: 'Type' }).click();
    await page.getByRole('option', { name: 'Attribute', exact: true }).click();
    await ruleRow.getByRole('combobox', { name: 'Operator' }).click();
    await page.getByRole('option', { name: 'before', exact: true }).click();

    // `before` with no date is a 400 on PUT /rules, which would land after the
    // flag itself was already written.
    await expect(ruleRow.getByText('Pick a date.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
