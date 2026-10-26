import { expect, test } from '../fixtures/base.fixture';

// The page texts come from the lazily fetched `auth` scope. A message that the
// component translates before that scope lands is shown as a raw key.
test.describe('Mailed-token pages', () => {
  for (const { path, title, noToken } of [
    {
      path: '/verify-email',
      title: 'Verification failed',
      noToken: 'No verification token provided.'
    },
    {
      path: '/confirm-email-change',
      title: 'Confirmation failed',
      noToken: 'No confirmation token provided.'
    },
    {
      path: '/reset-password',
      title: 'Invalid reset link',
      noToken: 'No reset token provided.'
    }
  ]) {
    test(`${path} with no token shows a translated message`, async ({
      _mockServer,
      page
    }) => {
      await page.goto(path);

      await expect(page.getByText(title)).toBeVisible();
      await expect(page.getByText(noToken)).toBeVisible();
      await expect(page.getByText(/auth\.\w+\./)).toHaveCount(0);
    });
  }

  test('an unknown confirmation token shows the reason from the server', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/confirm-email-change?token=unknown-token');

    await expect(page.getByText('Confirmation failed')).toBeVisible();
    await expect(
      page.getByText('Email-change confirmation token is invalid or expired')
    ).toBeVisible();
  });
});
