import type { Page } from '@playwright/test';

import {
  createValidJwt,
  defaultUser,
  expect,
  loginViaUi,
  test
} from '../fixtures/base.fixture';

function mockRefreshTokenWithNewTokens(page: Page) {
  return page.route('**/api/v1/auth/refresh-token', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tokens: {
          access_token: createValidJwt(),
          expires_in: 3600
        },
        user: defaultUser
      })
    })
  );
}

function mockProfile(page: Page) {
  return page.route('**/api/v1/auth/profile', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(defaultUser)
      });
    }
    return route.fallback();
  });
}

function setExpiredAuthInStorage(page: Page) {
  return page.addInitScript((user) => {
    localStorage.setItem('auth_user', JSON.stringify(user));
  }, defaultUser);
}

test.describe('Session restoration with expired access token', () => {
  test('should refresh tokens and restore session when access token is expired', async ({
    _mockServer,
    page
  }) => {
    await setExpiredAuthInStorage(page);

    let refreshTokenCalled = false;
    await page.route('**/api/v1/auth/refresh-token', (route) => {
      refreshTokenCalled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tokens: {
            access_token: createValidJwt(),
            expires_in: 3600
          },
          user: defaultUser
        })
      });
    });

    await mockProfile(page);

    await page.goto('/profile');

    // Should NOT be redirected to login — session should be restored via refresh
    await expect(page).toHaveURL(/.*\/profile$/);
    await expect(page.getByRole('heading', { name: 'John Doe' })).toBeVisible();

    // Verify the refresh-token request was actually made
    expect(refreshTokenCalled).toBe(true);
  });

  // A tab that was open across the release of the single name field holds a
  // user of the old shape. The store refuses it, so the reload is an
  // anonymous bootstrap: the user signs in once more, and nothing breaks.
  test('asks for a new sign-in when the stored user has the old name fields', async ({
    _mockServer,
    page
  }) => {
    await loginViaUi(page, _mockServer.url);
    await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('auth_user') ?? '{}') as {
        name?: string;
      };
      const { name: _name, ...rest } = stored;
      localStorage.setItem(
        'auth_user',
        JSON.stringify({ ...rest, firstName: 'John', lastName: 'Doe' })
      );
    });

    await page.reload();

    await expect(page).toHaveURL(/.*\/login/);
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();

    await loginViaUi(page, _mockServer.url);
  });

  test('should redirect to login when refresh token is also invalid', async ({
    _mockServer,
    page
  }) => {
    await setExpiredAuthInStorage(page);

    // Mock refresh-token endpoint to fail
    await page.route('**/api/v1/auth/refresh-token', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Invalid refresh token',
          statusCode: 401
        })
      })
    );

    await page.goto('/profile');

    // Should be redirected to login since refresh failed
    await expect(page).toHaveURL(/.*\/login/);
  });

  test('should restore session and navigate to profile from root URL', async ({
    _mockServer,
    page
  }) => {
    await _mockServer.seedUsers([defaultUser]);
    await setExpiredAuthInStorage(page);
    await mockRefreshTokenWithNewTokens(page);
    await mockProfile(page);

    // Regular user has no admin nav links, so the root route redirects to
    // /profile via SidenavStateService.defaultRoute() fallback.
    await page.goto('/');

    await expect(page).toHaveURL(/.*\/profile$/);
    await expect(page.getByRole('heading', { name: 'John Doe' })).toBeVisible();
  });
});
