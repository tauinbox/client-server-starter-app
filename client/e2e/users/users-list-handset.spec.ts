import { expect, loginViaUi, test } from '../fixtures/base.fixture';

// Angular CDK BreakpointObserver's Breakpoints.Handset evaluates to a media
// query that matches at widths <= 599px (portrait). 375x812 is the iPhone X
// viewport and is safely inside that range.
const HANDSET_VIEWPORT = { width: 375, height: 812 };

test.describe('User List page — handset layout', () => {
  test.use({ viewport: HANDSET_VIEWPORT });

  test('should render card list instead of table at handset width', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users');

    // Wait for data to load — any visible card is a good signal.
    await expect(page.locator('mat-card.user-card').first()).toBeVisible();

    const tableCount = await page.locator('table').count();
    expect(tableCount).toBe(0);

    const cardCount = await page.locator('mat-card.user-card').count();
    expect(cardCount).toBeGreaterThan(0);
  });

  test('should show empty state on handset when no users', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.route('**/api/v1/users?*', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [],
            meta: { page: 1, limit: 10, total: 0, totalPages: 0 }
          })
        });
      }
      return route.fallback();
    });
    await page.goto('/users');

    await expect(page.getByText('No Users Found')).toBeVisible();
    await expect(page.locator('mat-card.user-card')).toHaveCount(0);
  });

  test('should open actions menu and navigate to detail view', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    const knownUser = {
      id: '1',
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      isActive: true,
      roles: ['admin'],
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    };
    await page.route('**/api/v1/users?*', (route) => {
      if (
        route.request().method() === 'GET' &&
        !route.request().url().includes('/search')
      ) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [knownUser],
            meta: { page: 1, limit: 10, total: 1, totalPages: 1 }
          })
        });
      }
      return route.fallback();
    });
    await page.goto('/users');

    const card = page.locator('mat-card.user-card').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Admin User');
    await expect(card).toContainText('admin@example.com');

    await card.locator('button.user-card-menu-trigger').click();

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    await menu.getByRole('menuitem', { name: /View Details/i }).click();

    await expect(page).toHaveURL(/.*\/users\/1$/);
  });

  test('should show confirmation as bottom sheet when deleting from card menu', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    const knownUser = {
      id: '3',
      email: 'john@example.com',
      firstName: 'John',
      lastName: 'Smith',
      isActive: true,
      roles: ['user'],
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: '2025-02-01T00:00:00.000Z',
      updatedAt: '2025-02-01T00:00:00.000Z'
    };
    await page.route('**/api/v1/users?*', (route) => {
      if (
        route.request().method() === 'GET' &&
        !route.request().url().includes('/search')
      ) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [knownUser],
            meta: { page: 1, limit: 10, total: 1, totalPages: 1 }
          })
        });
      }
      return route.fallback();
    });
    await page.goto('/users');

    const card = page.locator('mat-card.user-card').first();
    await expect(card).toBeVisible();

    await card.locator('button.user-card-menu-trigger').click();
    // The delete menu item's accessible name comes from its aria-label,
    // which resolves to "Delete <firstName> <lastName>".
    await page
      .getByRole('menu')
      .getByRole('menuitem', { name: 'Delete John Smith' })
      .click();

    // On handset viewport, confirm opens as a bottom sheet instead of a dialog
    const bottomSheet = page.locator('mat-bottom-sheet-container');
    await expect(bottomSheet).toBeVisible();
    await expect(
      page.getByText(/Are you sure you want to delete user John Smith/)
    ).toBeVisible();

    // Verify both action buttons are present
    await expect(
      bottomSheet.getByRole('button', { name: 'Cancel' })
    ).toBeVisible();
    await expect(
      bottomSheet.getByRole('button', { name: 'Delete' })
    ).toBeVisible();
  });
});
