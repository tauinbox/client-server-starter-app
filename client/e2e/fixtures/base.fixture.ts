import type { Page } from '@playwright/test';
import { test as base } from '@playwright/test';

type Fixtures = {
  mockApi: Page;
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

// Re-export everything so spec files don't need import changes
export { base64url, createExpiredJwt, createMockJwt, createValidJwt } from './jwt.utils';
export type { MockUser } from './mock-data';
export { defaultTokens, defaultUser, mockUsersList } from './mock-data';
export {
  mockLogin,
  mockLoginError,
  mockProfile,
  mockRefreshToken,
  mockRegister,
  mockRegisterError,
  mockUpdateUser
} from './mocks/auth.mocks';
export {
  mockDeleteUser,
  mockDeleteUserError,
  mockGetUser,
  mockGetUserError,
  mockGetUsers,
  mockSearchUsers,
  mockSearchUsersWithCapture,
  mockUpdateUserError
} from './mocks/users.mocks';
export {
  expectAuthRedirect,
  expectForbiddenRedirect,
  loginViaUi
} from './helpers';
