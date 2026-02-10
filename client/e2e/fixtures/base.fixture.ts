import type { Page } from '@playwright/test';
import { test as base } from '@playwright/test';

type MockUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

type Fixtures = {
  mockApi: Page;
};

const defaultUser: MockUser = {
  id: '1',
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
  isActive: true,
  isAdmin: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z'
};

// Valid JWT with exp far in the future (year 2099) so auth guard doesn't reject it.
// Uses base64url encoding (no padding) as required by JWT spec.
function base64url(obj: Record<string, unknown>): string {
  return btoa(JSON.stringify(obj))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createMockJwt(): string {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64url({ sub: '1', exp: 4102444800 });
  return `${header}.${payload}.mock-signature`;
}

const defaultTokens = {
  access_token: createMockJwt(),
  refresh_token: createMockJwt(),
  expires_in: 3600
};

export const test = base.extend<Fixtures>({
  mockApi: async ({ page }, use) => {
    // Block real API calls by default — return 404 for unhandled routes
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 404, body: 'Not mocked' })
    );
    await use(page);
  }
});

export { expect } from '@playwright/test';

export function mockLogin(page: Page, user: Partial<MockUser> = {}) {
  return page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tokens: defaultTokens,
        user: { ...defaultUser, ...user }
      })
    })
  );
}

export function mockLoginError(
  page: Page,
  status = 401,
  message = 'Invalid credentials'
) {
  return page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ message, statusCode: status })
    })
  );
}

export function mockProfile(page: Page, user: Partial<MockUser> = {}) {
  return page.route('**/api/v1/auth/profile', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...defaultUser, ...user })
    })
  );
}

export function mockRegister(page: Page, user: Partial<MockUser> = {}) {
  return page.route('**/api/v1/auth/register', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ...defaultUser, ...user })
    })
  );
}

export function mockRegisterError(
  page: Page,
  status = 409,
  message = 'User with this email already exists'
) {
  return page.route('**/api/v1/auth/register', (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ message, statusCode: status })
    })
  );
}

export function mockRefreshToken(page: Page, user: Partial<MockUser> = {}) {
  return page.route('**/api/v1/auth/refresh-token', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tokens: defaultTokens,
        user: { ...defaultUser, ...user }
      })
    })
  );
}
