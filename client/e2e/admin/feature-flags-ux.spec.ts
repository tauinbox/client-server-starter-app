import { expect, loginViaUi, test } from '../fixtures/base.fixture';

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
      id: '100',
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
      id: '101',
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

    // Composite outcome: NO "Feature flag updated" success snackbar, only the
    // distinct rules-failure message with the flag key interpolated in.
    await expect(
      page.getByText(
        'Flag "beta-export" updated, but rules failed to save. Reopen to retry.'
      )
    ).toBeVisible();

    // Persistent warning marker — survives after the snackbar dismisses.
    await expect(
      page.getByRole('row', { name: /beta-export/ }).locator('.rules-warning')
    ).toBeVisible();
  });
});
