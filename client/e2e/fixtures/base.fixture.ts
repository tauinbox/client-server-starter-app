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

export function mockUpdateUser(page: Page, user: Partial<MockUser> = {}) {
  return page.route('**/api/v1/users/*', (route) => {
    if (route.request().method() === 'PATCH') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...defaultUser, ...user })
      });
    }
    return route.fallback();
  });
}

export async function loginViaUi(
  page: Page,
  user: Partial<MockUser> = {}
): Promise<void> {
  await mockLogin(page, user);
  await mockRefreshToken(page, user);
  await mockProfile(page, user);
  await page.goto('/login');
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('main').getByRole('button', { name: 'Login' }).click();
  await page.waitForURL(/.*\/profile$/);
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

// --- Users API mocks ---

export const mockUsersList: MockUser[] = [
  {
    id: '1',
    email: 'admin@example.com',
    firstName: 'Admin',
    lastName: 'User',
    isAdmin: true,
    isActive: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z'
  },
  {
    id: '2',
    email: 'john@example.com',
    firstName: 'John',
    lastName: 'Smith',
    isAdmin: false,
    isActive: true,
    createdAt: '2025-02-01T00:00:00.000Z',
    updatedAt: '2025-02-01T00:00:00.000Z'
  },
  {
    id: '3',
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    isAdmin: false,
    isActive: false,
    createdAt: '2025-03-01T00:00:00.000Z',
    updatedAt: '2025-03-01T00:00:00.000Z'
  }
];

export function mockGetUsers(page: Page, users: MockUser[] = mockUsersList) {
  return page.route('**/api/v1/users', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(users)
      });
    }
    return route.fallback();
  });
}

export function mockGetUser(page: Page, user: Partial<MockUser> = {}) {
  return page.route('**/api/v1/users/*', (route) => {
    if (
      route.request().method() === 'GET' &&
      !route.request().url().includes('/search')
    ) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...mockUsersList[0], ...user })
      });
    }
    return route.fallback();
  });
}

export function mockGetUserError(page: Page, status = 404) {
  return page.route('**/api/v1/users/*', (route) => {
    if (
      route.request().method() === 'GET' &&
      !route.request().url().includes('/search')
    ) {
      return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'User not found', statusCode: status })
      });
    }
    return route.fallback();
  });
}

export function mockSearchUsers(
  page: Page,
  users: MockUser[] = mockUsersList
) {
  return page.route('**/api/v1/users/search*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(users)
    })
  );
}

export function mockSearchUsersWithCapture(
  page: Page,
  capturedUrls: string[],
  users: MockUser[] = mockUsersList
) {
  return page.route('**/api/v1/users/search*', (route) => {
    capturedUrls.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(users)
    });
  });
}

export function mockDeleteUser(page: Page) {
  return page.route('**/api/v1/users/*', (route) => {
    if (route.request().method() === 'DELETE') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}'
      });
    }
    return route.fallback();
  });
}

export function mockDeleteUserError(page: Page) {
  return page.route('**/api/v1/users/*', (route) => {
    if (route.request().method() === 'DELETE') {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Failed to delete user',
          statusCode: 500
        })
      });
    }
    return route.fallback();
  });
}

export function mockUpdateUserError(page: Page) {
  return page.route('**/api/v1/users/*', (route) => {
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
}
