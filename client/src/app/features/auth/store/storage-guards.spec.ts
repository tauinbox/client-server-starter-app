import { isPersistedUser } from './storage-guards';

const validUser = {
  id: '1',
  email: 'test@example.com',
  name: 'Test User',
  roles: []
};

describe('isPersistedUser', () => {
  it('should accept an object carrying every field the app reads', () => {
    expect(isPersistedUser(validUser)).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'user'],
    ['an array', [validUser]],
    ['a partial object', { id: '1' }],
    ['a non-string name', { ...validUser, name: 42 }],
    ['a non-array roles', { ...validUser, roles: 'admin' }]
  ])('should reject %s', (_label, value) => {
    expect(isPersistedUser(value)).toBe(false);
  });
});
