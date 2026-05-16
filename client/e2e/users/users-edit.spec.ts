import {
  expect,
  expectAuthRedirect,
  loginViaUi,
  test
} from '../fixtures/base.fixture';

test.describe('User Edit page', () => {
  test('should redirect to login when not authenticated', async ({
    _mockServer,
    page
  }) => {
    await expectAuthRedirect(page, '/users/1/edit');
  });

  test('should populate form with user data', async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1/edit');

    await expect(page.getByLabel('Email')).toHaveValue('admin@example.com');
    await expect(page.getByLabel('First Name')).toHaveValue('Admin');
    await expect(page.getByLabel('Last Name')).toHaveValue('User');
  });

  test('should show status checkbox when logged in as admin', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1/edit');

    await expect(page.getByLabel('Active')).toBeVisible();
  });

  test('should redirect non-admin to forbidden on edit page', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {});
    await page.goto('/users/3/edit');

    await expect(page).toHaveURL(/.*\/forbidden$/);
  });

  test('should show "Delete" button for admin editing another user', async ({
    _mockServer,
    page
  }) => {
    // Login as user id=100 (admin), edit user id=3 (another user)
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/3/edit');

    await expect(
      page.getByRole('button', { name: 'Delete', exact: true })
    ).toBeVisible();
  });

  test('should not show "Delete" button for admin editing self', async ({
    _mockServer,
    page
  }) => {
    // Login as user id=100 (admin), edit user id=100 (self)
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/100/edit');

    await expect(
      page.getByRole('button', { name: 'Delete', exact: true })
    ).toBeHidden();
  });

  test('should redirect non-admin to forbidden on edit self', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, {});
    await page.goto('/users/100/edit');

    await expect(page).toHaveURL(/.*\/forbidden$/);
  });

  test('should show validation errors on blur', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1/edit');

    await page.getByLabel('Email').clear();
    await page.getByLabel('First Name').click();

    await expect(page.getByText('Email is required')).toBeVisible();

    await page.getByLabel('First Name').clear();
    await page.getByLabel('Last Name').click();

    await expect(page.getByText('First name is required')).toBeVisible();

    await page.getByLabel('Last Name').clear();
    await page.getByLabel('Email').click();

    await expect(page.getByText('Last name is required')).toBeVisible();
  });

  test('should update user successfully', async ({ _mockServer, page }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/1/edit');

    await page.getByLabel('First Name').fill('Updated');
    await page.getByLabel('First Name').blur();
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect(page.getByText('User updated successfully')).toBeVisible();
    await expect(page).toHaveURL(/.*\/users\/1$/);
  });

  test('should show error message on update failure', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    // Intercept PATCH to return 500
    await page.route('**/api/v1/users/*', (route) => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Failed to update user',
            statusCode: 500
          })
        });
      }
      return route.fallback();
    });
    await page.goto('/users/1/edit');

    await page.getByLabel('First Name').fill('Updated');
    await page.getByLabel('First Name').blur();
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect(page.locator('.error-message')).toBeVisible();
  });

  test('should show confirmation dialog when changing email', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/3/edit');

    await page.getByLabel('Email').fill('renamed@example.com');
    await page.getByLabel('Email').blur();
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Confirm email change')).toBeVisible();
    await expect(page.getByText(/renamed@example\.com/)).toBeVisible();
  });

  test('should not call PATCH when email-change dialog is cancelled', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });

    let patchCalled = false;
    await page.route('**/api/v1/users/*', (route) => {
      if (route.request().method() === 'PATCH') {
        patchCalled = true;
      }
      return route.fallback();
    });

    await page.goto('/users/3/edit');
    await page.getByLabel('Email').fill('renamed@example.com');
    await page.getByLabel('Email').blur();
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel' })
      .click();

    await expect(page.getByRole('dialog')).toBeHidden();
    expect(patchCalled).toBe(false);
  });

  test('should submit email change after confirmation', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/3/edit');

    await page.getByLabel('Email').fill('renamed@example.com');
    await page.getByLabel('Email').blur();
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Change email' })
      .click();

    await expect(page.getByText('User updated successfully')).toBeVisible();
    await expect(page).toHaveURL(/.*\/users\/3$/);
  });

  test('should show confirmation dialog on "Delete" click', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/3/edit');

    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Confirm Delete')).toBeVisible();
  });

  test('should delete and redirect to /users on confirm', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/3/edit');

    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();

    await expect(page.getByText('User deleted successfully')).toBeVisible();
    await expect(page).toHaveURL(/.*\/users$/);
  });

  test('action buttons do not fuse at 375px (gap or wrap)', async ({
    _mockServer,
    page
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await loginViaUi(page, _mockServer.url, { roles: ['admin'] });
    await page.goto('/users/3/edit');

    await expect(
      page.getByRole('button', { name: 'Delete', exact: true })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Save Changes' })
    ).toBeVisible();

    const layout = await page.evaluate(() => {
      const fa = document.querySelector('.form-actions');
      if (!fa) throw new Error('.form-actions not found');
      const buttons = Array.from(fa.querySelectorAll('button'));
      const rects = buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return { top: r.top, left: r.left, right: r.right };
      });
      return { rects, viewportWidth: window.innerWidth };
    });

    expect(layout.rects.length).toBeGreaterThanOrEqual(3);

    // No button may overflow the viewport horizontally.
    for (const r of layout.rects) {
      expect(r.right).toBeLessThanOrEqual(layout.viewportWidth + 0.5);
    }

    // For every pair of buttons that share a row (same top), there must be a
    // horizontal gap > 0 between them — they must not fuse edge-to-edge.
    for (let i = 0; i < layout.rects.length; i++) {
      for (let j = i + 1; j < layout.rects.length; j++) {
        const a = layout.rects[i];
        const b = layout.rects[j];
        const sameRow = Math.abs(a.top - b.top) < 1;
        if (sameRow) {
          const gap = Math.max(b.left - a.right, a.left - b.right);
          expect(gap).toBeGreaterThan(0);
        }
      }
    }
  });
});
