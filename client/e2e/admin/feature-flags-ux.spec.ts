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

  test('FF-UX-008: removing every rule saves the flag and the rules in one PATCH', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: mockId('user-101'),
      email: 'rulesadmin@example.com',
      roles: ['admin']
    });

    const writes: { method: string; url: string; body: unknown }[] = [];
    page.on('request', (req) => {
      if (
        req.url().includes('/api/v1/admin/feature-flags') &&
        req.method() !== 'GET'
      ) {
        writes.push({
          method: req.method(),
          url: req.url(),
          body: req.postDataJSON() as unknown
        });
      }
    });

    await page.goto('/admin/feature-flags');

    const editButton = page
      .getByRole('row', { name: /beta-export/ })
      .getByRole('button', { name: /Edit flag beta-export/ });
    await editButton.click();

    let dialog = await openedDialog(page);
    // beta-export is seeded with one percentage rule.
    await dialog.getByRole('button', { name: 'Remove rule' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();

    // Removing the only include rule leaves an enabled flag with no include
    // rules, so saving prompts the "enable for everyone" confirmation.
    await page
      .getByRole('button', { name: 'Confirm' })
      .click({ timeout: 5_000 });

    await expect(
      page.getByText('Feature flag "beta-export" updated')
    ).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('PATCH');
    expect(writes[0].url).toMatch(/\/admin\/feature-flags\/[^/]+$/);
    expect(writes[0].body).toMatchObject({ rules: [] });

    await page.reload();
    await editButton.click();
    dialog = await openedDialog(page);
    await expect(dialog.locator('nxs-feature-flag-rule-row')).toHaveCount(0);
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

  test('FF-UX-010: a rule the server would reject blocks the save before the request', async ({
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
    await ruleRow.getByRole('combobox', { name: 'Field' }).click();
    await page.getByRole('option', { name: 'Created at', exact: true }).click();
    await ruleRow.getByRole('combobox', { name: 'Operator' }).click();
    await page.getByRole('option', { name: 'before', exact: true }).click();

    // `before` with no date is a 400 on save, so the dialog blocks it first.
    await expect(ruleRow.getByText('Pick a date.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('FF-UX-011: the custom attribute key is picked from the registered set', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: mockId('user-104'),
      email: 'flagkeyadmin@example.com',
      roles: ['admin']
    });

    await page.goto('/admin/feature-flags');

    await page
      .getByRole('row', { name: /oauth-google/ })
      .getByRole('button', { name: /Edit flag oauth-google/ })
      .click();

    const dialog = await openedDialog(page);
    const ruleRow = dialog.locator('nxs-feature-flag-rule-row').first();
    const keyInput = ruleRow.getByRole('combobox', { name: 'Custom key' });

    await expect(keyInput).toHaveValue('oauthGoogleConfigured');

    // An unregistered key is a 400 on save, so the dialog blocks it first.
    await keyInput.fill('plan');
    await expect(
      ruleRow.getByText(
        'This key is not registered on the server. Select one from the list.'
      )
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();

    await keyInput.fill('');
    await keyInput.click();
    await page
      .getByRole('option', { name: 'oauthGoogleConfigured', exact: true })
      .click();

    await expect(keyInput).toHaveValue('oauthGoogleConfigured');
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  test('FF-UX-012: a percentage rule saves and reloads its bucketBy', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: mockId('user-104'),
      email: 'flagbucketadmin@example.com',
      roles: ['admin']
    });

    await page.goto('/admin/feature-flags');
    const editButton = page
      .getByRole('row', { name: /beta-export/ })
      .getByRole('button', { name: /Edit flag beta-export/ });
    await editButton.click();

    let dialog = await openedDialog(page);
    const bucketBy = dialog.getByRole('combobox', { name: 'Bucket by' });
    // The seed rule has no bucketBy, which the server reads as user.
    await expect(bucketBy).toHaveText('User');
    await bucketBy.click();
    await page.getByRole('option', { name: 'Device', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText('Feature flag "beta-export" updated')
    ).toBeVisible();
    await expect(dialog).toBeHidden();

    await page.reload();
    await editButton.click();
    dialog = await openedDialog(page);
    await expect(
      dialog.getByRole('combobox', { name: 'Bucket by' })
    ).toHaveText('Device');
  });
});
