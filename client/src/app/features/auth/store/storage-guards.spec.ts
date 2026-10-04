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

  it('should accept resources of the expected shape', () => {
    expect(isCachedRbacMetadata({ resources: [resource] })).toBe(true);
  });

  it('should accept an empty collection', () => {
    expect(isCachedRbacMetadata({ resources: [] })).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'rbac'],
    ['a missing collection', {}],
    ['a non-array collection', { resources: 'nope' }],
    ['a resource without a subject', { resources: [{ name: 'u' }] }]
  ])('should reject %s', (_label, value) => {
    expect(isCachedRbacMetadata(value)).toBe(false);
  });
});
