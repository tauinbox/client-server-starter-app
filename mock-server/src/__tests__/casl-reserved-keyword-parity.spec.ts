import {
  findUserByEmail,
  getPackedRulesForUser,
  getState,
  resetState
} from '../state';
import type { MockUser } from '../types';

const NOW = '2025-01-01T00:00:00.000Z';

beforeEach(() => {
  resetState();
});

function editorUser(): MockUser {
  const user = findUserByEmail('user@example.com');
  if (!user) throw new Error('seed user missing');
  user.roles = ['editor'];
  return user;
}

function grantToEditor(permissionId: string, deny = false): void {
  getState().rolePermissions.push({
    id: `rp-${permissionId}`,
    roleId: 'role-editor',
    permissionId,
    conditions: deny ? { effect: 'deny' } : null
  });
}

function addReservedAction(): string {
  const state = getState();
  state.actions.set('act-manage', {
    id: 'act-manage',
    name: 'manage',
    displayName: 'Manage',
    description: 'Reserved keyword that bypassed the write-time check',
    isDefault: false,
    createdAt: NOW
  });
  state.permissions.set('perm-users-manage', {
    id: 'perm-users-manage',
    resourceId: 'res-users',
    actionId: 'act-manage',
    description: null,
    createdAt: NOW
  });
  return 'perm-users-manage';
}

function addReservedSubjectResource(): string {
  const state = getState();
  state.resources.set('res-wildcard', {
    id: 'res-wildcard',
    name: 'wildcard',
    subject: 'all',
    displayName: 'Wildcard',
    description: 'Reserved keyword that bypassed the write-time check',
    isSystem: false,
    isOrphaned: false,
    isRegistered: true,
    allowedActionNames: null,
    lastSyncedAt: NOW,
    createdAt: NOW
  });
  const readAction = [...state.actions.values()].find((a) => a.name === 'read');
  if (!readAction) throw new Error('seed action read missing');
  state.permissions.set('perm-wildcard-read', {
    id: 'perm-wildcard-read',
    resourceId: 'res-wildcard',
    actionId: readAction.id,
    description: null,
    createdAt: NOW
  });
  return 'perm-wildcard-read';
}

// Mirrors casl-ability.factory.ts: rows carrying a CASL reserved keyword can
// only come from a write that bypassed the API checks, and packing them would
// hand the client a wildcard grant.
describe('reserved CASL keyword parity with server', () => {
  it('packs no rule for an allow whose action is reserved', () => {
    grantToEditor(addReservedAction());

    expect(getPackedRulesForUser(editorUser())).toEqual([]);
  });

  it('packs no rule for an allow whose subject is reserved', () => {
    grantToEditor(addReservedSubjectResource());

    expect(getPackedRulesForUser(editorUser())).toEqual([]);
  });

  it('keeps a deny whose action is reserved', () => {
    grantToEditor(addReservedAction(), true);

    const rules = getPackedRulesForUser(editorUser());

    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain('manage');
    expect(rules[0]).toContain('User');
  });

  it('leaves the rest of the permission set untouched', () => {
    const state = getState();
    const readAction = [...state.actions.values()].find(
      (a) => a.name === 'read'
    );
    const usersRead = [...state.permissions.values()].find(
      (p) => p.resourceId === 'res-users' && p.actionId === readAction?.id
    );
    if (!usersRead) throw new Error('seed permission users/read missing');

    grantToEditor(addReservedAction());
    grantToEditor(usersRead.id);

    const rules = getPackedRulesForUser(editorUser());

    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain('read');
  });
});
