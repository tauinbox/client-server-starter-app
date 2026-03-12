/**
 * Verifies that every value in a TypeScript enum is covered by a PostgreSQL
 * migration (either in a CREATE TYPE ... AS ENUM or ALTER TYPE ... ADD VALUE).
 *
 * Prevents the class of bug where a new enum value is added to the shared
 * TypeScript enum but the corresponding PostgreSQL type is never extended,
 * causing PG error 22P02 at runtime even though the primary operation succeeds.
 *
 * Usage (from server/): npm run check:enums
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── config ──────────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = path.resolve(__dirname, '../src/migrations');

/**
 * Map: TypeScript enum source file → PostgreSQL type name to check against.
 * Add new entries here when a new TS enum maps to a PostgreSQL ENUM column.
 */
const ENUM_CHECKS: { enumFile: string; pgType: string }[] = [
  {
    enumFile: path.resolve(
      __dirname,
      '../../shared/src/enums/audit-action.enum.ts'
    ),
    pgType: 'audit_logs_action_enum'
  }
];

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Extract string values from a TypeScript string enum (e.g. FOO = 'FOO'). */
function readEnumValues(filePath: string): string[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  return [...source.matchAll(/\w+\s*=\s*'(\w+)'/g)].map((m) => m[1]);
}

/**
 * Collect every enum value covered by migrations for the given PostgreSQL type.
 * Scans CREATE TYPE ... AS ENUM (...) and ALTER TYPE ... ADD VALUE statements.
 */
function readMigrationCoverage(
  migrationsDir: string,
  pgType: string
): Set<string> {
  const covered = new Set<string>();

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.ts'))
    .sort();

  for (const file of files) {
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    // CREATE TYPE "pgType" AS ENUM ('VAL1', 'VAL2', ...)
    const createMatch = content.match(
      new RegExp(
        `CREATE\\s+TYPE\\s+"?${pgType}"?\\s+AS\\s+ENUM\\s*\\(([^)]+)\\)`,
        'si'
      )
    );
    if (createMatch) {
      [...createMatch[1].matchAll(/'(\w+)'/g)].forEach((m) =>
        covered.add(m[1])
      );
    }

    // ALTER TYPE "pgType" ADD VALUE [IF NOT EXISTS] 'VAL'
    [
      ...content.matchAll(
        new RegExp(
          `ALTER\\s+TYPE\\s+"?${pgType}"?\\s+ADD\\s+VALUE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?'(\\w+)'`,
          'gi'
        )
      )
    ].forEach((m) => covered.add(m[1]));
  }

  return covered;
}

// ─── main ─────────────────────────────────────────────────────────────────────

function main(): void {
  let allOk = true;

  for (const { enumFile, pgType } of ENUM_CHECKS) {
    const enumValues = readEnumValues(enumFile);
    const covered = readMigrationCoverage(MIGRATIONS_DIR, pgType);
    const missing = enumValues.filter((v) => !covered.has(v));

    if (missing.length === 0) {
      console.log(
        `✓ ${pgType} is in sync (${enumValues.length} value${enumValues.length === 1 ? '' : 's'})`
      );
      continue;
    }

    allOk = false;
    console.error(
      `✗ ${pgType} is missing ${missing.length} value${missing.length === 1 ? '' : 's'}:\n`
    );
    missing.forEach((v) => console.error(`    + ${v}`));
    console.error(
      `\n  → Add a migration with:\n` +
        missing
          .map(
            (v) =>
              `      ALTER TYPE "${pgType}" ADD VALUE IF NOT EXISTS '${v}';`
          )
          .join('\n') +
        '\n'
    );
  }

  if (!allOk) process.exit(1);
}

main();
