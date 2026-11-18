import type { Page } from '@playwright/test';
import {
  test,
  expect,
  loginViaApi,
  loginViaUiKeepSse
} from '../fixtures/base.fixture';

const USER_ID = '200';

function bell(page: Page) {
  return page.locator('nxs-header a.notices-link');
}

test.describe('Billing notices', () => {
  test('a paid invoice shows in the bell and on the notices page, and reading it clears the count', async ({
    page,
    _mockServer
  }) => {
    await loginViaApi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await _mockServer.activateBillingSubscription({
      userId: USER_ID,
      planKey: 'pro'
    });
    await page.goto('/');

    await expect(bell(page)).toHaveAccessibleName('Notifications, 1 unread');

    await bell(page).click();

    await expect(page).toHaveURL(/\/billing\/notifications$/);
    const notice = page.locator('.notice');

    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveClass(/unread/);
    await expect(notice.locator('.notice-text')).toHaveText(
      /We received your payment of \$\d+\.\d{2}\./
    );

    await notice.getByRole('button', { name: 'Mark as read' }).click();

    await expect(notice).not.toHaveClass(/unread/);
    await expect(
      notice.getByRole('button', { name: 'Mark as read' })
    ).toHaveCount(0);
    await expect(bell(page)).toHaveAccessibleName('Notifications');
  });

  test('a self-managed renewal shows its date and amount once for each period', async ({
    page,
    _mockServer
  }) => {
    await loginViaApi(page, _mockServer.url, { id: USER_ID, roles: ['user'] });
    await _mockServer.activateBillingSubscription({
      userId: USER_ID,
      planKey: 'pro',
      provider: 'yookassa'
    });

    expect(
      await _mockServer.sendBillingRenewalNotice({ userId: USER_ID })
    ).toEqual({ sent: true });
    expect(
      await _mockServer.sendBillingRenewalNotice({ userId: USER_ID })
    ).toEqual({ sent: false });

    await page.goto('/billing/notifications');

    const notices = page.locator('.notice');

    // The paid first invoice and one renewal notice.
    await expect(notices).toHaveCount(2);
    await expect(notices.first().locator('.notice-text')).toHaveText(
      /Your Pro subscription renews on \w+ \d{1,2}, \d{4}\. On that day we take RUB\s990\.00 from your saved card\. To stop the renewal, cancel the subscription before that day\./
    );
  });

  test('notices reach an open tab live: the bell first, then the open notices page', async ({
    page,
    _mockServer
  }) => {
    // The live stream instead of the empty stub of the base fixture.
    await page.unroute(/\/api\/.*\/notifications\/stream/);

    // The mock registers the connection before it sends the headers, so a
    // push after the response reaches this tab.
    const streamOpen = page.waitForResponse((r) =>
      r.url().includes('/api/v1/notifications/stream')
    );

    await loginViaUiKeepSse(page, _mockServer.url, {
      id: USER_ID,
      roles: ['user']
    });
    await streamOpen;
    await expect(bell(page)).toHaveAccessibleName('Notifications');

    await _mockServer.activateBillingSubscription({
      userId: USER_ID,
      planKey: 'pro'
    });

    await expect(bell(page)).toHaveAccessibleName('Notifications, 1 unread');

    // An in-app navigation keeps the same stream open.
    await bell(page).click();
    await expect(page.locator('.notice')).toHaveCount(1);

    await _mockServer.advanceBillingRenewal({
      userId: USER_ID,
      outcome: 'failure'
    });

    await expect(page.locator('.notice')).toHaveCount(2);
    // A Paddle subscription: the provider runs the retries, so no date.
    await expect(page.locator('.notice').first()).toContainText(
      'The payment for the Pro plan failed. The payment provider will try again.'
    );
    await expect(bell(page)).toHaveAccessibleName('Notifications, 2 unread');
  });
});
