import { expect, loginViaUiKeepSse, test } from '../fixtures/base.fixture';

// Regression for the role-permission fan-out path. Scenario: an admin changes
// a *role's* permission set (not a single user's role membership). Every
// currently-connected holder of that role must have their abilities refreshed
// live — the server emits `RolePermissionsChangedEvent(holderIds)` →
// `NotificationsListener` pushes a `permissions_updated` SSE frame per holder.
//
// This is deliberately distinct from `role-revocation-via-sse.spec.ts` (which
// strips a user's role): here the user keeps their role, but the role loses the
// permission that gated a control. Tokens are NOT revoked — abilities are
// re-derived from the DB per request, so the session continues.
//
// Given a user holds a non-super role whose only permission (`read Role`) makes
// the sidenav admin link visible, when an admin revokes that permission from
// the role and the SSE event fires, then the admin link must disappear without
// a reload and without the user navigating.
test.describe('Live RBAC update via SSE — role-permission fan-out', () => {
  test('admin link disappears when the holder role loses its gating permission', async ({
    _mockServer,
    page
  }) => {
    // Drop the empty-body SSE stub so the client holds a real stream open
    // against mock-server's SSE hub (same trick as the sibling SSE specs).
    await page.unroute(/\/api\/.*\/notifications\/stream/);

    // Grant the seeded non-super `auditor` role a single `read Role` permission,
    // which is one of the four abilities that surface the admin panel link.
    await _mockServer.seedPermissions([
      {
        id: 'perm-test-read-role',
        resourceId: 'res-roles',
        actionId: 'act-read',
        description: 'Read Role',
        createdAt: '2025-01-01T00:00:00.000Z'
      }
    ]);
    await _mockServer.changeRolePermissions('auditor', ['perm-test-read-role']);

    const userId = '100';
    await loginViaUiKeepSse(page, _mockServer.url, {
      id: userId,
      roles: ['auditor']
    });

    // The sidenav renders on every authenticated page; /profile is reachable
    // with only `read Role` (no User/Role page guard to trip).
    await page.goto('/profile');

    const adminLink = page.getByRole('link', { name: 'Admin Panel' });
    await expect(adminLink).toBeVisible();

    // Server-side: revoke the role's permission and fan out the SSE event to
    // every holder. The client re-fetches /auth/permissions, the new (empty)
    // ability is built, and `canAccessAdminPanel` flips false on the next
    // change-detection cycle — no reload, no navigation.
    await _mockServer.changeRolePermissions('auditor', []);

    await expect(adminLink).toBeHidden({ timeout: 15_000 });
  });
});
