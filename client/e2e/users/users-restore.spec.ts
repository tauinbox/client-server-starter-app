import type { Page } from '@playwright/test';
import { mockId } from '../fixtures/ids';

import { expect, loginViaUi, test } from '../fixtures/base.fixture';
import { createMockUser } from '../fixtures/mock-data';
import type { MockUser } from '../fixtures/mock-data';

const baseUser = {
  lastName: 'Restorable',
  password: 'Password1',
  roles: ['user'],
  isActive: false,
  isEmailVerified: true,
  failedLoginAttempts: 0,
  lockedUntil: null,
  tokenRevokedAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z'
} satisfies Partial<MockUser>;

// Deactivated BEFORE deletion: restoring must not silently re-enable it.
const deletedUser: MockUser = createMockUser({
  ...baseUser,
  id: mockId('user-900'),
  email: 'deleted.restorable@example.com',
  firstName: 'Deleted',
  deletedAt: '2025-02-01T00:00:00.000Z'
});

const liveUser: MockUser = createMockUser({
  ...baseUser,
  id: mockId('user-901'),
  email: 'live.restorable@example.com',
  firstName: 'Live',
  deletedAt: null
});

/**
 * The mock seeds ~70 users and the list is infinite-scrolled 20 at a time, so a
 * fixture user is only reachable through the search filter.
 */
async function search(
  page: Page,
  q: string,
  opts: { includeDeleted: boolean }
): Promise<void> {
  await page.getByLabel('Search').fill(q);
  await page
    .getByRole('checkbox', { name: 'Include deleted users' })
    .setChecked(opts.includeDeleted);
  await page.getByRole('button', { name: 'Search' }).click();
}

const restoreButton = (page: Page, row: ReturnType<Page['getByRole']>) =>
  row.locator('button', {
    has: page.locator('mat-icon', { hasText: 'restore_from_trash' })
  });

const deleteButton = (page: Page, row: ReturnType<Page['getByRole']>) =>
  row.locator('button', {
    has: page.locator('mat-icon', { hasText: 'delete' })
  });

// Scoped to the status cell: "Deleted" also appears in the fixture's email and
// name, and the role column carries chips of its own.
const statusChip = (row: ReturnType<Page['getByRole']>) =>
  row.locator('.mat-column-status mat-chip');

test.describe('Deleted users on the user list', () => {
  test.beforeEach(async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await _mockServer.seedUsers([deletedUser, liveUser]);
    await page.goto('/users');
    await expect(page.locator('table tbody tr').first()).toBeVisible();
  });

  test('hides deleted users until the filter is enabled', async ({ page }) => {
    const row = page.getByRole('row', { name: /deleted\.restorable/ });

    await search(page, 'restorable@example.com', { includeDeleted: false });
    await expect(
      page.getByRole('row', { name: /live\.restorable/ })
    ).toBeVisible();
    await expect(row).toBeHidden();

    await search(page, 'restorable@example.com', { includeDeleted: true });
    await expect(row).toBeVisible();
  });

  test('marks a deleted row and offers restore as its only action', async ({
    page
  }) => {
    await search(page, 'deleted.restorable@example.com', {
      includeDeleted: true
    });
    const row = page.getByRole('row', { name: /deleted\.restorable/ });

    await expect(statusChip(row)).toHaveText('Deleted');
    await expect(restoreButton(page, row)).toBeVisible();
    await expect(deleteButton(page, row)).toBeHidden();
  });

  test('restore clears the deletion but keeps the account deactivated', async ({
    page
  }) => {
    await search(page, 'deleted.restorable@example.com', {
      includeDeleted: true
    });
    const row = page.getByRole('row', { name: /deleted\.restorable/ });

    await restoreButton(page, row).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Restore' })
      .click();

    await expect(page.getByText('User restored successfully')).toBeVisible();
    // The account was deactivated before deletion; restore lifts the deletion
    // only, so it must come back Inactive rather than Active.
    await expect(statusChip(row)).toHaveText('Inactive');
  });

  test('keeps a deleted row visible after deleting a live user', async ({
    page
  }) => {
    await search(page, 'live.restorable@example.com', { includeDeleted: true });
    const row = page.getByRole('row', { name: /live\.restorable/ });

    await deleteButton(page, row).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect(page.getByText('User deleted successfully')).toBeVisible();
    await expect(statusChip(row)).toHaveText('Deleted');
    await expect(restoreButton(page, row)).toBeVisible();
  });
});
