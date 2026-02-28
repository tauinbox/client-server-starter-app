import type { Page } from '@playwright/test';

import {
  createValidJwt,
  defaultUser,
  expect,
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
    await expect(page.getByText('My Profile')).toBeVisible();

    // Verify the refresh-token request was actually made
    expect(refreshTokenCalled).toBe(true);
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
    await setExpiredAuthInStorage(page);
    await mockRefreshTokenWithNewTokens(page);
    await mockProfile(page);

    // Navigate to root — should redirect to /profile via route config
    await page.goto('/');

    // Should end up at /profile, not /login
    await expect(page).toHaveURL(/.*\/profile$/);
    await expect(page.getByText('My Profile')).toBeVisible();
  });
});
