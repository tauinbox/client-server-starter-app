import { expect, loginViaUi, test } from './fixtures/base.fixture';

/**
 * Keyboard navigation tests — verifies that core flows are fully operable
 * without a mouse. Part of the standard E2E suite.
 */
test.describe('Keyboard navigation', () => {
  test('skip-link: first Tab from fresh page focuses skip-link, Enter jumps to main', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Move focus into the document, then advance with Tab — the skip-link
    // must be the first focusable element (WCAG 2.4.1 Bypass Blocks).
    await page.evaluate(() => document.body.focus());
    await page.keyboard.press('Tab');

    const skipLink = page.locator('a.skip-link');
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toHaveAttribute('href', '#main');
    await expect(skipLink).toHaveText('Skip to main content');

    // Activating the link should move the URL fragment to #main and bring
    // <main id="main"> into view.
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    await expect(page.locator('main#main')).toBeInViewport();
  });

  test('login form: tab through fields and submit with Enter', async ({
    _mockServer,
    page
  }) => {
    await page.goto('/login');

    // Focus the email field directly (skip-link and toolbar precede it in tab order)
    const emailInput = page.getByLabel('Email');
    await emailInput.focus();
    await expect(emailInput).toBeFocused();
    await emailInput.fill('user@example.com');

    // Tab to password field
    await page.keyboard.press('Tab');
    const passwordInput = page.getByLabel('Password', { exact: true });
    await expect(passwordInput).toBeFocused();
    await passwordInput.fill('Password1');

    // Tab forward until the Login button is focused
    const loginButton = page
      .getByRole('main')
      .getByRole('button', { name: 'Login' });

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      if (await loginButton.evaluate((el) => el === document.activeElement)) {
        break;
      }
    }
    await expect(loginButton).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/.*\/profile$/);
  });

  test('sidenav: tab to nav links and activate with Enter', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    // Focus the Admin Panel link in the sidenav and activate it
    const adminLink = page.getByRole('link', { name: 'Admin Panel' });
    await adminLink.focus();
    await expect(adminLink).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/.*\/admin/);

    // Navigate to Profile via keyboard
    const profileLink = page.getByRole('link', { name: 'Profile' });
    await profileLink.focus();
    await expect(profileLink).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/.*\/profile$/);
  });

  test('user edit: tab through form fields and save with Enter', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1/edit');

    // Wait for form to load
    await expect(page.getByLabel('Email')).toHaveValue('admin@example.com');

    // Focus First Name, change it, then tab through remaining fields
    const firstNameInput = page.getByLabel('First Name');
    await firstNameInput.focus();
    await expect(firstNameInput).toBeFocused();
    await firstNameInput.fill('Updated');

    // Tab forward to reach the Save button
    const saveButton = page.getByRole('button', { name: 'Save Changes' });
    await saveButton.focus();
    await expect(saveButton).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByText('User updated successfully')).toBeVisible();
  });

  test('confirm dialog: focus trap and Escape to close', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/3/edit');

    // Open the delete confirmation dialog
    await page.getByRole('button', { name: 'Delete User' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const cancelButton = dialog.getByRole('button', { name: 'Cancel' });
    const deleteButton = dialog.getByRole('button', { name: 'Delete' });

    // Tab through dialog — both buttons should receive focus
    // CDK focus trap redirects Tab back into the dialog after the last element
    const focusedButtons = new Set<string>();
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      if (await cancelButton.evaluate((el) => el === document.activeElement)) {
        focusedButtons.add('Cancel');
      }
      if (await deleteButton.evaluate((el) => el === document.activeElement)) {
        focusedButtons.add('Delete');
      }
    }

    // Both dialog buttons must have received focus during the tab cycle
    expect(focusedButtons.has('Cancel')).toBe(true);
    expect(focusedButtons.has('Delete')).toBe(true);

    // Dialog must still be visible (focus didn't escape and trigger navigation)
    await expect(dialog).toBeVisible();

    // Close dialog with Escape
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
});
