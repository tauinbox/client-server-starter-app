import {
  buildAbilityForUser,
  findUserByEmail,
  getState,
  resetState
} from '../state';
import type { MockUser } from '../types';
import { mockId } from '../utils/mock-id';

beforeEach(() => {
  resetState();
});

function editorUser(): MockUser {
  const user = findUserByEmail('user@example.com');
  if (!user) throw new Error('seed user missing');
  user.roles = ['editor'];
  return user;
}

function orphanUsersResource(): void {
  const resource = getState().resources.get(mockId('res-users'));
  if (!resource) throw new Error('seed resource users missing');
  resource.isOrphaned = true;
}

function grantUsersReadToEditor(deny = false): void {
  const state = getState();
  const readAction = [...state.actions.values()].find((a) => a.name === 'read');
  if (!readAction) throw new Error('seed action read missing');
  const usersRead = [...state.permissions.values()].find(
    (p) => p.resourceId === mockId('res-users') && p.actionId === readAction.id
  );
  if (!usersRead) throw new Error('seed permission users/read missing');

  state.rolePermissions.push({
    id: 'rp-users-read',
    roleId: mockId('role-editor'),
    permissionId: usersRead.id,
    conditions: deny ? { effect: 'deny' } : null
  });
}

// Mirrors casl-ability.factory.ts: an allow needs a live resource, while a deny
// must outlive its resource going orphaned rather than vanish with it.
describe('orphaned resource parity with server', () => {
  it('registers no rule for an allow whose resource is orphaned', () => {
    grantUsersReadToEditor();
    orphanUsersResource();

    expect(buildAbilityForUser(editorUser()).rules).toEqual([]);
  });

  it('keeps a deny whose resource is orphaned', () => {
    grantUsersReadToEditor(true);
    orphanUsersResource();

    const [rule, ...rest] = buildAbilityForUser(editorUser()).rules;

    expect(rest).toHaveLength(0);
    expect(rule.inverted).toBe(true);
    expect(rule.action).toBe('read');
    expect(rule.subject).toBe('User');
  });

  it('keeps an allow whose resource is live', () => {
    grantUsersReadToEditor();

    const [rule, ...rest] = buildAbilityForUser(editorUser()).rules;

    expect(rest).toHaveLength(0);
    expect(rule.inverted).toBeFalsy();
    expect(rule.action).toBe('read');
    expect(rule.subject).toBe('User');
  });
});
