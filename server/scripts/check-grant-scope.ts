/**
 * Read-only report on existing permission grants versus the grant-scope rule.
 *
 * `assertCanGrantPermissions` requires a granted condition to CONTAIN the
 * granting caller's own condition. That rule is applied to writes only - rows
 * already in `role_permissions` are deliberately not re-validated, because
 * retro-validating live grants would silently strip permissions in production.
 * This script is the diagnostic that fills that gap: it reports which stored
 * grants the rule would reject today, without changing anything.
 *
 *   npm run check:grant-scope
 *
 * It opens one connection, runs three SELECTs and exits. It never writes.
 * The analysis itself lives in `modules/auth/utils/grant-scope-report.ts`, which
 * is unit-tested; this file is only I/O and formatting.
 *
 * Sections. B, C and D partition every row by what could be decided about it;
 * A is a second, independent axis and therefore overlaps them - a vetoed grant
 * is still attributed (or not) like any other, so the counts deliberately sum
 * to more than the row total.
 *   A. Inert grants - the stored condition is vetoed by `resolveConditions`,
 *      so the permission already registers nothing at runtime and the grant
 *      rule would reject it on rewrite. Actor-independent, no inference.
 *   B. Grants their author could not re-authorize today - attributed through
 *      the most recent PERMISSION_ASSIGN audit row and re-run through the real
 *      `assertCanGrantPermissions` against the author's current ability.
 *   C. Attributed grants the check accepts today - a count, so the row
 *      arithmetic can be reconciled.
 *   D. Unattributed grants - no PERMISSION_ASSIGN row, so they were seeded or
 *      their audit row aged out of AUDIT_LOG_RETENTION_DAYS. Counted, never
 *      judged.
 *
 * Limits, stated because a reader will otherwise assume they do not exist:
 *   - `role_permissions` has no grantor column, so section B rests entirely on
 *     the audit trail, which is pruned (90 days by default).
 *   - The audit row records `permissionIds` but NOT the conditions, so the
 *     author is attributed to the CURRENT stored condition. A later edit by a
 *     different actor through the same route re-attributes the row.
 *   - Abilities are evaluated as they are NOW, not as they were at grant time.
 *   - A verdict is therefore evidence to review, never proof of an escalation.
 *
 * Exits 1 when section A or B has findings so it can be wired into a gate
 * later; sections C and D alone never fail the run.
 */

import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import {
  analyzeGrants,
  grantLabel,
  type AuditRow,
  type GrantRow,
  type UserRoleRow
} from '../src/modules/auth/utils/grant-scope-report';

dotenv.config();

async function main(): Promise<void> {
  // Minimal DataSource - no entities, schema or migrations. Only raw SELECTs.
  const ds = new DataSource({
    type: 'postgres',
    host: process.env['DB_HOST'],
    port: process.env['DB_PORT'] ? Number(process.env['DB_PORT']) : 5432,
    username: process.env['DB_USER'],
    password: process.env['DB_PASSWORD'],
    database: process.env['DB_NAME'],
    schema: process.env['DB_SCHEMA'] ?? 'public',
    entities: [],
    migrations: [],
    synchronize: false,
    logging: false
  });
  await ds.initialize();

  // `users."isActive"` is camelCase in the schema while everything else is
  // snake_case - the naming strategy has not been applied to it yet.
  const [grants, userRoles, auditRows] = await Promise.all([
    ds.query<GrantRow[]>(`
      SELECT rp.role_id, r.name AS role_name, r.is_super AS role_is_super,
             rp.permission_id, act.name AS action_name,
             res.name AS resource_name, res.subject AS resource_subject,
             res.is_orphaned, rp.conditions
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
      JOIN resources res ON res.id = p.resource_id
      JOIN actions act ON act.id = p.action_id
    `),
    ds.query<UserRoleRow[]>(`
      SELECT u.id AS user_id, u.email, ur.role_id,
             r.name AS role_name, r.is_super
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE u."isActive" = true AND u.deleted_at IS NULL
    `),
    ds.query<AuditRow[]>(`
      SELECT al.target_id AS role_id, al.actor_id, al.actor_email,
             al.created_at, al.details
      FROM audit_logs al
      WHERE al.action = 'PERMISSION_ASSIGN' AND al.target_type = 'Role'
      ORDER BY al.created_at ASC
    `)
  ]);

  await ds.destroy();

  const report = analyzeGrants({ grants, userRoles, auditRows });

  console.log(
    `Grant scope report (read-only)\n` +
      `  ${report.totalGrants} role_permission row(s), ` +
      `${report.activeUsersWithRoles} active user(s) with roles, ` +
      `${report.auditRows} PERMISSION_ASSIGN audit row(s)\n` +
      `  B+C+D partition the rows; A is an independent axis and overlaps them.\n`
  );

  console.log(
    `A. Inert grants - condition vetoed by the resolver: ${report.inert.length}`
  );
  if (report.inert.length > 0) {
    console.log(
      `   These register nothing at runtime today and the grant rule rejects them on rewrite.`
    );
    for (const row of report.inert) {
      console.log(`   - ${grantLabel(row)}`);
      console.log(`       condition : ${JSON.stringify(row.conditions)}`);
    }
  }
  console.log('');

  console.log(
    `B. Grants the attributed author could not re-authorize today: ${report.findings.length}`
  );
  for (const f of report.findings) {
    console.log(`   - ${grantLabel(f.row)}`);
    console.log(
      `       authored by  : ${f.author.actor_email ?? f.author.actor_id} on ` +
        `${new Date(f.author.created_at).toISOString()}`
    );
    console.log(
      `       verdict      : 403 ${f.verdict.errorKey ?? '-'}` +
        `${f.verdict.reason ? ` (${f.verdict.reason})` : ''}`
    );
    console.log(`       condition    : ${JSON.stringify(f.row.conditions)}`);
    if (f.selfReachable) {
      console.log(
        `       NOTE         : the author currently holds this role, so the grant is ` +
          `self-reachable - review this one first`
      );
    }
  }
  console.log('');

  console.log(`C. Re-checked and accepted: ${report.accepted}\n`);

  const notJudged =
    report.unattributed + report.authorSuper + report.authorGone;
  console.log(`D. Not judged: ${notJudged}`);
  console.log(
    `   ${report.unattributed} unattributed (seeded, or the audit row aged out of ` +
      `AUDIT_LOG_RETENTION_DAYS)\n` +
      `   ${report.authorSuper} authored by a super role (bypasses the check by design)\n` +
      `   ${report.authorGone} authored by a user who is now inactive, deleted or role-less\n`
  );

  if (report.inert.length > 0 || report.findings.length > 0) {
    console.error(
      `Findings above are evidence to review, not proof: abilities are evaluated as they\n` +
        `are now, and the audit row records permission ids without the conditions.\n` +
        `Nothing was modified.`
    );
    process.exit(1);
  }

  console.log('No findings. Nothing was modified.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
