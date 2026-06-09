import { expect, loginViaUi, test } from '../fixtures/base.fixture';

// The admin billing console lists every customer's subscriptions and invoices
// and exposes the two M1 mutations (cancel, refund). We seed an active
// subscription + paid invoice through the success-webhook control hook, then
// drive the admin actions and assert the lifecycle transitions render.
const ADMIN_ID = '100';

test.describe('Admin billing console', () => {
  test('lists, cancels a subscription and refunds an invoice', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: ADMIN_ID,
      email: 'billadmin@example.com',
      roles: ['admin']
    });

    // Seed a subscription + default payment method + paid invoice for the admin.
    await _mockServer.activateBillingSubscription({
      userId: ADMIN_ID,
      planKey: 'pro'
    });

    // The billing tab is visible in the admin nav (provider configured in mock).
    await expect(
      page
        .getByRole('tab', { name: 'Billing' })
        .or(page.getByRole('link', { name: 'Billing' }))
    ).toBeVisible();

    await page.goto('/admin/billing');

    const subTable = page.locator('table').first();
    const invoiceTable = page.locator('table').nth(1);

    await expect(
      page.getByText('Subscriptions', { exact: true })
    ).toBeVisible();
    await expect(subTable.locator('tbody tr')).toHaveCount(1);
    await expect(subTable).toContainText('pro');
    await expect(subTable).toContainText('Active');

    // Cancel the subscription immediately via the row menu.
    await subTable.locator('tbody').getByRole('button').first().click();
    await page.getByRole('menuitem', { name: 'Cancel immediately' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel subscription' })
      .click();
    await expect(subTable).toContainText('Canceled');

    // Refund the paid invoice.
    await expect(invoiceTable.locator('tbody tr')).toHaveCount(1);
    await expect(invoiceTable).toContainText('Paid');
    await invoiceTable.getByRole('button', { name: 'Refund' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Refund' })
      .click();
    await expect(invoiceTable).toContainText('Refunded');
  });
});
