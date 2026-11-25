/**
 * Keeps the two migration sets apart, and keeps the seeders on the home pool.
 *
 * - `src/migrations/` is the frozen history of the time when one database held
 *   every table: a file there newer than `LAST_FROZEN_MIGRATION` is refused.
 * - `src/migrations/settings/` runs only on the home pool, on the settings
 *   database: a file there that names a regional table is refused.
 * - `src/migrations/regional/` runs on every pool: a file there that names a
 *   settings table is refused. Another folder is refused.
 * - Each seeder writes settings rows: a seeder that does not call
 *   `assertSettingsWriter(` is refused.
 *
 * A table is named as a quoted identifier (`"roles"`), as the generated
 * migrations write it. The tables of each set come from the entities
 * (`SETTINGS_ENTITIES` of `src/data-sources.ts`) and from `EXTRA_TABLES`.
 *
 * Usage (from server/): npm run check:migration-sets
 *        npm run check:migration-sets -- --self-test
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getMetadataArgsStorage } from 'typeorm';
import { SETTINGS_ENTITIES } from '../src/data-sources';
import { loadEntities } from '../src/postgres.config';

const SRC = path.resolve(__dirname, '../src');

/** The newest migration of the frozen history. */
const LAST_FROZEN_MIGRATION = 1795533760005;

/** The tables that no entity maps, by set. */
const EXTRA_TABLES = {
  settings: [
    'settings_change_log',
    'settings_change_epoch',
    'settings_migrations'
  ],
  regional: ['settings_change_applied', 'migrations']
};

type Sets = { settings: string[]; regional: string[] };

const MIGRATION_FILE = /^(\d+)-[\w-]+\.ts$/;

function tableSets(): Sets {
  const entities = loadEntities();
  const settings = new Set<unknown>(SETTINGS_ENTITIES);
  const sets: Sets = {
    settings: [...EXTRA_TABLES.settings],
    regional: [...EXTRA_TABLES.regional]
  };

  for (const { target, name } of getMetadataArgsStorage().tables) {
    if (!name || !entities.includes(target as NewableFunction)) continue;

    (settings.has(target) ? sets.settings : sets.regional).push(name);
  }

  return sets;
}

function namedTables(source: string, tables: string[]): string[] {
  return tables.filter((table) => source.includes(`"${table}"`));
}

function scan(root: string, sets: Sets): string[] {
  const violations: string[] = [];
  const migrations = path.join(root, 'migrations');

  for (const entry of fs.readdirSync(migrations, { withFileTypes: true })) {
    const full = path.join(migrations, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== 'settings' && entry.name !== 'regional') {
        violations.push(
          `migrations/${entry.name}/: a migration folder must be settings/ or regional/`
        );
        continue;
      }

      const foreign = entry.name === 'settings' ? sets.regional : sets.settings;

      for (const file of fs.readdirSync(full).toSorted()) {
        if (!file.endsWith('.ts')) continue;

        const named = namedTables(
          fs.readFileSync(path.join(full, file), 'utf8'),
          foreign
        );

        if (named.length > 0) {
          violations.push(
            `migrations/${entry.name}/${file}: names a table of the other set: ${named.join(', ')}`
          );
        }
      }
    } else {
      const timestamp = MIGRATION_FILE.exec(entry.name)?.[1];

      if (timestamp && Number(timestamp) > LAST_FROZEN_MIGRATION) {
        violations.push(
          `migrations/${entry.name}: the top level is frozen; put the migration in migrations/settings/ or migrations/regional/`
        );
      }
    }
  }

  const seeders = path.join(root, 'seeders');

  for (const file of fs.readdirSync(seeders).toSorted()) {
    if (!file.endsWith('.seeder.ts')) continue;

    if (
      !fs
        .readFileSync(path.join(seeders, file), 'utf8')
        .includes('assertSettingsWriter(')
    ) {
      violations.push(
        `seeders/${file}: a seeder writes settings, so it starts with assertSettingsWriter()`
      );
    }
  }

  return violations;
}

function selfTest(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-migration-sets-'));
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };

  try {
    write('migrations/1700000000000-old.ts', 'ALTER TABLE "roles"; "users"');
    write(`migrations/${LAST_FROZEN_MIGRATION + 1}-new.ts`, '"users"');
    write('migrations/settings/1800000000000-ok.ts', 'ALTER TABLE "roles"');
    write('migrations/settings/1800000000001-bad.ts', 'ALTER TABLE "users"');
    write('migrations/regional/1800000000002-ok.ts', 'ALTER TABLE "users"');
    write('migrations/regional/1800000000003-bad.ts', 'DROP TABLE "roles"');
    write('migrations/other/1800000000004-x.ts', '');
    write('seeders/ok.seeder.ts', 'assertSettingsWriter();');
    write('seeders/bad.seeder.ts', 'export default class X {}');

    const found = scan(root, { settings: ['roles'], regional: ['users'] })
      .map((violation) => violation.split(':')[0])
      .toSorted();
    const expected = [
      `migrations/${LAST_FROZEN_MIGRATION + 1}-new.ts`,
      'migrations/other/',
      'migrations/regional/1800000000003-bad.ts',
      'migrations/settings/1800000000001-bad.ts',
      'seeders/bad.seeder.ts'
    ];

    if (found.join(',') !== expected.join(',')) {
      console.error(
        `ERROR: check-migration-sets self-test failed: expected ${expected.join(', ')}, got ${found.join(', ') || 'none'}.`
      );
      process.exit(1);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('check-migration-sets: self-test OK.');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const sets = tableSets();
  const violations = scan(SRC, sets);

  if (violations.length > 0) {
    console.error(
      'ERROR: the migration sets or the seeders break the split of the settings:\n' +
        violations.map((v) => `  src/${v}`).join('\n')
    );
    process.exit(1);
  }

  console.log(
    `check-migration-sets: OK - ${sets.settings.length} settings tables, ${sets.regional.length} regional tables.`
  );
}
