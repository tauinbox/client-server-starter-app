/**
 * Pre-deploy check for BKL-008.
 *
 * Connects to the configured database and inspects every row in
 * `role_permissions.conditions` to flag any that contain operators or fields
 * the SQL translator (apply-ability.util) cannot handle — i.e. any rule that
 * was being silently mistranslated under the pre-fix code and will now be
 * deny-all under the fail-closed translator.
 *
 * Run against a staging dump (or any environment with realistic data) before
 * merging the BKL-008 fix:
 *
 *   npm run build
 *   ts-node scripts/check-existing-role-conditions.ts
 *
 * Exits non-zero if any unsupported fragment is found, so it can be wired
 * into a CI gate later if needed.
 */

import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';

dotenv.config();

const SUPPORTED_USER_FIELDS = new Set([
  'id',
  'email',
  'firstName',
  'lastName',
  'isActive'
]);

const SUPPORTED_COMPARISON_OPS = new Set([
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte'
]);

const SUPPORTED_LIST_OPS = new Set(['$in', '$nin']);

const SUPPORTED_LOGICAL_OPS = new Set(['$and', '$or', '$nor', '$not']);

interface ConditionsRow {
  role_id: string;
  role_name: string | null;
  permission_id: string;
  resource_name: string | null;
  action_name: string | null;
  conditions: unknown;
}

interface Issue {
  rolePermission: string;
  reason: string;
  excerpt: string;
}

type CheckResult = { ok: true } | { ok: false; reason: string };

/**
 * Top-level / logical-op context: keys are either logical operators
 * ($and/$or/$nor/$not) or user-field names.
 */
function checkConditionsNode(node: unknown, path = ''): CheckResult {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return { ok: false, reason: `${path || '<root>'} must be a plain object` };
  }

  for (const [key, value] of Object.entries(node)) {
    const childPath = path ? `${path}.${key}` : key;

    if (SUPPORTED_LOGICAL_OPS.has(key)) {
      const sub = checkLogicalOp(key, value, childPath);
      if (!sub.ok) return sub;
      continue;
    }

    if (key.startsWith('$')) {
      return {
        ok: false,
        reason: `${childPath} → unknown operator "${key}"`
      };
    }

    if (!SUPPORTED_USER_FIELDS.has(key)) {
      return { ok: false, reason: `${childPath} → unknown field "${key}"` };
    }

    const sub = checkFieldValue(value, childPath);
    if (!sub.ok) return sub;
  }

  return { ok: true };
}

function checkLogicalOp(
  op: string,
  value: unknown,
  path: string
): CheckResult {
  if (op === '$not') {
    return checkConditionsNode(value, path);
  }
  if (!Array.isArray(value)) {
    return { ok: false, reason: `${path} → ${op} value must be array` };
  }
  for (let i = 0; i < value.length; i++) {
    const sub = checkConditionsNode(value[i], `${path}[${i}]`);
    if (!sub.ok) return sub;
  }
  return { ok: true };
}

/**
 * Field-value context: scalar (equality) or an object of field-level operators
 * ($eq/$ne/$gt/$gte/$lt/$lte/$in/$nin). Logical operators are NOT allowed here.
 */
function checkFieldValue(value: unknown, path: string): CheckResult {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return { ok: true };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: `${path} → unsupported value shape` };
  }

  for (const [op, opVal] of Object.entries(value)) {
    const childPath = `${path}.${op}`;
    if (SUPPORTED_COMPARISON_OPS.has(op)) {
      if (typeof opVal === 'object' && opVal !== null) {
        return {
          ok: false,
          reason: `${childPath} → ${op} value must be a scalar`
        };
      }
      continue;
    }
    if (SUPPORTED_LIST_OPS.has(op)) {
      if (!Array.isArray(opVal)) {
        return {
          ok: false,
          reason: `${childPath} → ${op} value must be array`
        };
      }
      continue;
    }
    return { ok: false, reason: `${childPath} → unknown operator "${op}"` };
  }
  return { ok: true };
}

async function main(): Promise<void> {
  // Minimal DataSource — no entities, schema, or migrations. Only needed for
  // raw SQL access via .query(); avoids loading the full module graph (which
  // pulls in path-aliased imports that ts-node doesn't resolve by default).
  const ds = new DataSource({
    type: 'postgres',
    host: process.env['DB_HOST'],
    port: process.env['DB_PORT']
      ? Number(process.env['DB_PORT'])
      : 5432,
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

  const rows = await ds.query<ConditionsRow[]>(`
    SELECT
      rp.role_id,
      r.name AS role_name,
      rp.permission_id,
      res.name AS resource_name,
      act.name AS action_name,
      rp.conditions
    FROM role_permissions rp
    LEFT JOIN roles r ON r.id = rp.role_id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    LEFT JOIN resources res ON res.id = p.resource_id
    LEFT JOIN actions act ON act.id = p.action_id
    WHERE rp.conditions IS NOT NULL
  `);

  const issues: Issue[] = [];

  for (const row of rows) {
    const permissionLabel =
      row.resource_name && row.action_name
        ? `${row.resource_name}:${row.action_name}`
        : row.permission_id;
    const label = `${row.role_name ?? row.role_id} → ${permissionLabel}`;
    const cond = row.conditions as Record<string, unknown> | null;
    if (!cond) continue;

    const custom = cond['custom'];
    if (typeof custom === 'string' && custom.trim().length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(custom);
      } catch {
        issues.push({
          rolePermission: label,
          reason: 'custom JSON does not parse',
          excerpt: custom.slice(0, 200)
        });
        continue;
      }
      const result = checkConditionsNode(parsed);
      if (!result.ok) {
        issues.push({
          rolePermission: label,
          reason: result.reason,
          excerpt: custom.slice(0, 200)
        });
      }
    }

    // ownership/fieldMatch/userAttr produce only $eq / $in fragments via
    // resolvers — those are always translatable. Skip them.
  }

  await ds.destroy();

  if (issues.length === 0) {
    console.log(
      `✓ Checked ${rows.length} role_permissions row(s) — all conditions are translatable.`
    );
    return;
  }

  console.error(
    `✗ Found ${issues.length} role_permission row(s) with conditions that the new fail-closed translator will DROP:\n`
  );
  for (const issue of issues) {
    console.error(`  • ${issue.rolePermission}`);
    console.error(`      reason : ${issue.reason}`);
    console.error(`      custom : ${issue.excerpt}\n`);
  }
  console.error(
    'These rules were being mistranslated by the pre-fix translator (silently over-sharing).\n' +
      'Either rewrite them using only supported operators ($eq/$ne/$in/$nin/$gt/$gte/$lt/$lte/$and/$or/$nor/$not)\n' +
      'against the user fields { id, email, firstName, lastName, isActive }, or accept that\n' +
      'they will become deny-all under the fix.'
  );
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
