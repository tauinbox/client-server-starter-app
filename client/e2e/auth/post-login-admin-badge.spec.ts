import { expect, loginViaUi, test } from '../fixtures/base.fixture';

/**
 * Regression: the server used to return `user.roles` as `string[]` (role
 * names) from `/auth/login`, while the client expected `RoleResponse[]`.
 * That made `AuthStore.isAdmin()` return false for admins immediately after
 * login and correct itself only after a page reload (which re-fetched
 * `/auth/profile` — a different endpoint that already returned objects).
 *
 * These tests pin the fixed wire contract end-to-end: an admin who logs in
 * must see the admin badge / chip on every relevant screen without reloading.
 */
test.describe('Post-login admin badge (BKL-002)', () => {
  test('should show "Administrator" chip on profile immediately after login — no reload', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    // loginViaUi waits for /profile URL — no additional navigation or reload.
    await expect(
      page.getByText('Administrator', { exact: true })
    ).toBeVisible();
  });

  test('should render Admin chip in users table for admin rows', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    await page.goto('/users');

    // The mock-server seed includes several admin users; the Role column must
    // render at least one "Admin" chip because the server returns
    // RoleResponse[] objects and the template detects admin via
    // `.some(r => r.name === 'admin')`. Pre-fix (`.includes('admin')` against
    // objects), the chip was never shown and all rows read "User".
    const adminCell = page
      .getByRole('cell', { name: 'Admin', exact: true })
      .first();
    await expect(adminCell).toBeVisible();
  });
});
