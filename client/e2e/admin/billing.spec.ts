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

  // The invoice list is cursor-paginated behind an infinite scroll: the page
  // must never request the whole table, and scrolling must fetch the next slice
  // from the server rather than filtering rows already in memory.
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
    // One invoice per renewal: 25 in total, so the default page size splits it.
    for (let i = 0; i < 24; i += 1) {
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
    // The sentinel keeps pulling pages while it stays in view, so the list
    // fills the viewport on open and settles once the server stops handing out
    // cursors - all 25 rows, never in one request.
    await expect(invoiceTable.locator('tbody tr')).toHaveCount(25);

    // The first request opens the sequence without a cursor; every later one
    // continues from the previous page rather than re-reading the table.
    expect(invoiceRequests[0]).not.toContain('cursor=');
    expect(invoiceRequests[0]).toContain('limit=');
    expect(
      invoiceRequests.slice(1).every((url) => url.includes('cursor='))
    ).toBe(true);
    // 25 rows at a 20-row page: two requests, not one unbounded read.
    expect(invoiceRequests).toHaveLength(2);

    // Exhausted: scrolling again asks for nothing more.
    await invoiceTable.locator('tbody tr').last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    expect(invoiceRequests).toHaveLength(2);
  });
});
