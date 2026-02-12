import type { Page } from '@playwright/test';

import { mockUsersList, type MockUser } from '../mock-data';

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
