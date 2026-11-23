import {
  findUserByEmail,
  resetState,
  toAdminUserResponse,
  toUserResponse
} from '../state';

// The server reads the roles of a user in a second query and sorts them by
// name in code-unit order (attachRoles), so the answers of the mock do too.
describe('the roles of a user are sorted by name', () => {
  beforeEach(() => {
    resetState();
  });

  it('in the user answer and the admin answer, whatever the order of assignment', () => {
    const user = findUserByEmail('user@example.com')!;

    user.roles = ['user', 'admin'];

    expect(toUserResponse(user).roles.map(({ name }) => name)).toEqual([
      'admin',
      'user'
    ]);
    expect(toAdminUserResponse(user).roles.map(({ name }) => name)).toEqual([
      'admin',
      'user'
    ]);
    expect(user.roles).toEqual(['user', 'admin']);
  });
});
