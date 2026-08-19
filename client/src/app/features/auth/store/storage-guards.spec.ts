import { isCachedRbacMetadata, isPersistedUser } from './storage-guards';

const validUser = {
  id: '1',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
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
    ['a non-string name', { ...validUser, firstName: 42 }],
    ['a non-array roles', { ...validUser, roles: 'admin' }]
  ])('should reject %s', (_label, value) => {
    expect(isPersistedUser(value)).toBe(false);
  });
});

describe('isCachedRbacMetadata', () => {
  const resource = { name: 'users', subject: 'User' };
  const action = { name: 'read' };

  it('should accept resources and actions of the expected shape', () => {
    expect(
      isCachedRbacMetadata({ resources: [resource], actions: [action] })
    ).toBe(true);
  });

  it('should accept empty collections', () => {
    expect(isCachedRbacMetadata({ resources: [], actions: [] })).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'rbac'],
    ['a missing collection', { resources: [resource] }],
    ['a non-array collection', { resources: 'nope', actions: [] }],
    [
      'a resource without a subject',
      { resources: [{ name: 'u' }], actions: [] }
    ],
    ['an action without a name', { resources: [], actions: [{ id: 'a' }] }]
  ])('should reject %s', (_label, value) => {
    expect(isCachedRbacMetadata(value)).toBe(false);
  });
});
