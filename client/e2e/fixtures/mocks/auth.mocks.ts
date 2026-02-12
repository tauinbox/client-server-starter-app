import type { Page } from '@playwright/test';

import { defaultTokens, defaultUser, type MockUser } from '../mock-data';

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
