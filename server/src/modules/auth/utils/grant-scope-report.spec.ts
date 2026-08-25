import { ErrorKeys } from '@app/shared/constants';
import type { PermissionCondition } from '@app/shared/types';
import {
  analyzeGrants,
  type AuditRow,
  type GrantRow,
  type UserRoleRow
} from './grant-scope-report';

/**
 * The fixture mirrors the scenario this report was verified against on a real
 * Postgres instance: one `update:User` permission, an author who holds it only
 * over themselves, and four roles carrying it under different conditions.
 */
const PERMISSION_ID = 'perm-update-user';
const ALICE = 'alice-id';

const OWNERSHIP: PermissionCondition = { ownership: { userField: 'id' } };

function grant(
  roleId: string,
  roleName: string,
  conditions: PermissionCondition | null
): GrantRow {
  return {
    role_id: roleId,
    role_name: roleName,
    role_is_super: false,
    permission_id: PERMISSION_ID,
    action_name: 'update',
    resource_name: 'User',
    resource_subject: 'User',
    is_orphaned: false,
    conditions
  };
}

function audit(roleId: string, actorId: string | null): AuditRow {
  return {
    role_id: roleId,
    actor_id: actorId,
    actor_email: actorId ? 'alice@example.com' : null,
    created_at: new Date('2026-08-25T00:00:00.000Z'),
    details: { permissionIds: [PERMISSION_ID] }
  };
}

const aliceHoldsNarrow: UserRoleRow = {
  user_id: ALICE,
  email: 'alice@example.com',
  role_id: 'role-narrow',
  role_name: 'narrow-admin',
  is_super: false
};

describe('analyzeGrants', () => {
  it('flags a grant broader than the attributed author holds', () => {
    const report = analyzeGrants({
      grants: [
        grant('role-narrow', 'narrow-admin', OWNERSHIP),
        grant('role-wide', 'wide-role', { fieldMatch: { isActive: [true] } })
      ],
      userRoles: [aliceHoldsNarrow],
      auditRows: [audit('role-wide', ALICE)]
    });

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].row.role_name).toBe('wide-role');
    expect(report.findings[0].verdict).toMatchObject({
      rejected: true,
      errorKey: ErrorKeys.ROLES.CONDITION_BROADER_THAN_CALLER,
      reason: 'condition-broader-than-caller'
    });
  });

  it('accepts a grant that keeps the author condition and adds a restriction', () => {
    const report = analyzeGrants({
      grants: [
        grant('role-narrow', 'narrow-admin', OWNERSHIP),
        grant('role-strict', 'stricter-role', {
          ownership: { userField: 'id' },
          fieldMatch: { isActive: [true] }
        })
      ],
      userRoles: [aliceHoldsNarrow],
      auditRows: [audit('role-strict', ALICE)]
    });

    expect(report.findings).toHaveLength(0);
    expect(report.accepted).toBe(1);
  });

  it('accepts a grant equal to the author condition', () => {
    const report = analyzeGrants({
      grants: [
        grant('role-narrow', 'narrow-admin', OWNERSHIP),
        grant('role-equal', 'equal-role', OWNERSHIP)
      ],
      userRoles: [aliceHoldsNarrow],
      auditRows: [audit('role-equal', ALICE)]
    });

    expect(report.findings).toHaveLength(0);
    expect(report.accepted).toBe(1);
  });

  it('reports a vetoed condition as inert, independently of any author', () => {
    const report = analyzeGrants({
      grants: [
        grant('role-inert', 'inert-role', {
          userAttr: { managerId: 'department' }
        })
      ],
      userRoles: [],
      auditRows: []
    });

    expect(report.inert).toHaveLength(1);
    expect(report.inert[0].role_name).toBe('inert-role');
    // No audit row, so it is unattributed as well - the two axes overlap.
    expect(report.unattributed).toBe(1);
  });

  it('marks a grant as self-reachable when the author holds the role', () => {
    const report = analyzeGrants({
      grants: [
        grant('role-narrow', 'narrow-admin', OWNERSHIP),
        grant('role-wide', 'wide-role', { fieldMatch: { isActive: [true] } })
      ],
      userRoles: [
        aliceHoldsNarrow,
        {
          user_id: ALICE,
          email: 'alice@example.com',
          role_id: 'role-wide',
          role_name: 'wide-role',
          is_super: false
        }
      ],
      auditRows: [audit('role-wide', ALICE)]
    });

    // Holding the role means the broad rule is already in the author's own
    // ability, so the check now passes - which is exactly the residual risk the
    // report exists to surface rather than hide.
    expect(report.findings).toHaveLength(0);
    expect(report.accepted).toBe(1);
  });

  it('does not judge a grant with no audit row', () => {
    const report = analyzeGrants({
      grants: [
        grant('role-wide', 'wide-role', { fieldMatch: { isActive: [true] } })
      ],
      userRoles: [aliceHoldsNarrow],
      auditRows: []
    });

    expect(report.findings).toHaveLength(0);
    expect(report.unattributed).toBe(1);
  });

  it('does not judge a grant authored by a super role', () => {
    const report = analyzeGrants({
      grants: [
        grant('role-wide', 'wide-role', { fieldMatch: { isActive: [true] } })
      ],
      userRoles: [
        {
          user_id: 'root-id',
          email: 'root@example.com',
          role_id: 'role-super',
          role_name: 'admin',
          is_super: true
        }
      ],
      auditRows: [audit('role-wide', 'root-id')]
    });

    expect(report.findings).toHaveLength(0);
    expect(report.authorSuper).toBe(1);
  });

  it('does not judge a grant whose author no longer has roles', () => {
    const report = analyzeGrants({
      grants: [
        grant('role-wide', 'wide-role', { fieldMatch: { isActive: [true] } })
      ],
      userRoles: [],
      auditRows: [audit('role-wide', 'ghost-id')]
    });

    expect(report.findings).toHaveLength(0);
    expect(report.authorGone).toBe(1);
  });

  it('attributes a row to the most recent write', () => {
    const older = audit('role-wide', 'ghost-id');
    const newer: AuditRow = {
      ...audit('role-wide', ALICE),
      created_at: new Date('2026-08-25T12:00:00.000Z')
    };

    const report = analyzeGrants({
      grants: [
        grant('role-narrow', 'narrow-admin', OWNERSHIP),
        grant('role-wide', 'wide-role', { fieldMatch: { isActive: [true] } })
      ],
      userRoles: [aliceHoldsNarrow],
      // Rows arrive oldest first, as the script's ORDER BY guarantees.
      auditRows: [older, newer]
    });

    expect(report.authorGone).toBe(0);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].author.actor_id).toBe(ALICE);
  });

  it('partitions every row across findings, accepted and not-judged', () => {
    const report = analyzeGrants({
      grants: [
        grant('role-narrow', 'narrow-admin', OWNERSHIP),
        grant('role-wide', 'wide-role', { fieldMatch: { isActive: [true] } }),
        grant('role-strict', 'stricter-role', {
          ownership: { userField: 'id' },
          fieldMatch: { isActive: [true] }
        }),
        grant('role-inert', 'inert-role', {
          userAttr: { managerId: 'department' }
        })
      ],
      userRoles: [aliceHoldsNarrow],
      auditRows: [audit('role-wide', ALICE), audit('role-strict', ALICE)]
    });

    const partition =
      report.findings.length +
      report.accepted +
      report.unattributed +
      report.authorSuper +
      report.authorGone;

    expect(partition).toBe(report.totalGrants);
    expect(report.findings).toHaveLength(1);
    expect(report.accepted).toBe(1);
    expect(report.unattributed).toBe(2);
    // The inert axis overlaps the partition rather than extending it.
    expect(report.inert).toHaveLength(1);
  });
});
