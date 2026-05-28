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
test.describe('Post-login admin badge', () => {
  test('should show the admin role chip on profile immediately after login — no reload', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    // loginViaUi waits for /profile URL — no additional navigation or reload.
    const roleChip = page
      .locator('.profile-badges mat-chip')
      .filter({ hasText: 'admin' });
    await expect(roleChip).toBeVisible();
    await expect(roleChip.locator('mat-icon')).toHaveText(
      'admin_panel_settings'
    );
  });

  test('should render the admin role chip in the users table for admin rows', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    await page.goto('/users');

    // The mock-server seed includes several admin users; the Role column must
    // render at least one admin chip because the server returns RoleResponse[]
    // objects and the chip is keyed on `r.name === 'admin'`. Pre-fix
    // (`.includes('admin')` against objects), no admin chip was ever shown.
    const adminChip = page
      .locator('.role-chips mat-chip')
      .filter({ hasText: 'admin' })
      .first();
    await expect(adminChip).toBeVisible();
    await expect(adminChip.locator('mat-icon')).toHaveText(
      'admin_panel_settings'
    );
  });

  // Given an admin logs in, when the AuthStore persists the authenticated user
  // to localStorage, then `user.roles` must be an array of RoleResponse objects
  // with a `name` field — never plain strings. Pre-fix the server returned
  // string[], the persisted shape was wrong, and the next page-reload read
  // back a structurally-broken `user` that downstream guards rejected.
  test('persists user.roles as RoleResponse[] in localStorage immediately after login', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    const storedRoles = await page.evaluate(() => {
      const raw = localStorage.getItem('auth_user');
      return raw ? (JSON.parse(raw) as { roles: unknown[] }).roles : null;
    });

    expect(Array.isArray(storedRoles)).toBe(true);
    expect(storedRoles).not.toHaveLength(0);
    const first = (storedRoles as Record<string, unknown>[])[0];
    expect(typeof first).toBe('object');
    expect(first).not.toBeNull();
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('name', 'admin');
  });
});
