import {
  expect,
  mockProfile,
  test
} from '../fixtures/base.fixture';

/**
 * Creates a base64url-encoded JWT with the given payload.
 */
function base64url(obj: Record<string, unknown>): string {
  return btoa(JSON.stringify(obj))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createExpiredJwt(): string {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  // exp = 1 hour ago
  const payload = base64url({
    sub: '1',
    exp: Math.floor(Date.now() / 1000) - 3600
  });
  return `${header}.${payload}.mock-signature`;
}

function createValidJwt(): string {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  // exp = year 2099
  const payload = base64url({ sub: '1', exp: 4102444800 });
  return `${header}.${payload}.mock-signature`;
}

const defaultUser = {
  id: '1',
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
  isActive: true,
  isAdmin: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z'
};

function mockRefreshTokenWithNewTokens(page: import('@playwright/test').Page) {
  return page.route('**/api/v1/auth/refresh-token', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tokens: {
          access_token: createValidJwt(),
          refresh_token: 'new-refresh-token',
          expires_in: 3600
        },
        user: defaultUser
      })
    })
  );
}

function setExpiredAuthInStorage(page: import('@playwright/test').Page) {
  const expiredAuthData = {
    tokens: {
      access_token: createExpiredJwt(),
      refresh_token: 'valid-refresh-token',
      expires_in: 3600
    },
    user: defaultUser
  };

  return page.addInitScript((authData) => {
    localStorage.setItem('auth_storage', JSON.stringify(authData));
  }, expiredAuthData);
}

test.describe('Session restoration with expired access token', () => {
  test('should refresh tokens and restore session when access token is expired', async ({
    mockApi: page
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
            refresh_token: 'new-refresh-token',
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
    mockApi: page
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

    // Mock logout endpoint
    await page.route('**/api/v1/auth/logout', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}'
      })
    );

    await page.goto('/profile');

    // Should be redirected to login since refresh failed
    await expect(page).toHaveURL(/.*\/login/);
  });

  test('should restore session and navigate to profile from root URL', async ({
    mockApi: page
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
