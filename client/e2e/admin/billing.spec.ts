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

  // The invoice list is server-paginated: the page must never request the whole
  // table, and moving the paginator must fetch the next slice from the server.
  test('pages through the invoice list without loading every row', async ({
    page,
    _mockServer
  }) => {
    await loginViaUi(page, _mockServer.url, {
      id: ADMIN_ID,
      email: 'billadmin@example.com',
      roles: ['admin']
    });

    const { id: subscriptionId } =
      await _mockServer.activateBillingSubscription({
        userId: ADMIN_ID,
        planKey: 'pro'
      });
    // One invoice per renewal: 12 in total, so the default page size splits it.
    for (let i = 0; i < 11; i += 1) {
      await _mockServer.advanceBillingRenewal({ subscriptionId });
    }

    const invoiceRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/admin/billing/invoices')) {
        invoiceRequests.push(request.url());
      }
    });

    await page.goto('/admin/billing');

    const invoiceTable = page.locator('table').nth(1);
    await expect(invoiceTable.locator('tbody tr')).toHaveCount(10);
    expect(invoiceRequests[0]).toContain('page=1');
    expect(invoiceRequests[0]).toContain('limit=10');

    const invoicePaginator = page.locator('mat-paginator').nth(1);
    await expect(invoicePaginator).toContainText('1 - 10 of 12');

    await invoicePaginator.getByRole('button', { name: 'Next page' }).click();

    await expect(invoiceTable.locator('tbody tr')).toHaveCount(2);
    await expect(invoicePaginator).toContainText('11 - 12 of 12');
    expect(invoiceRequests.at(-1)).toContain('page=2');
  });
});
