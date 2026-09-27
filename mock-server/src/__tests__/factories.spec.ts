import { createMockUser } from '../factories';

describe('createMockUser', () => {
  // With the old random default, about one call in five gave an inactive
  // account, so 100 calls in a row that all give an active one prove the
  // default is fixed.
  it('gives an active account when the caller omits isActive', () => {
    const users = Array.from({ length: 100 }, () => createMockUser());

    expect(users.every((user) => user.isActive)).toBe(true);
  });

  it('keeps an explicit isActive: false', () => {
    expect(createMockUser({ isActive: false }).isActive).toBe(false);
  });
});
