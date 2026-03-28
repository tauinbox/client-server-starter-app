/**
 * Verifies that every ErrorKeys value exists in all client i18n JSON files.
 *
 * Recursively extracts all leaf string values from the ErrorKeys const object,
 * then checks that each dot-path key resolves in every global i18n JSON file.
 * Exits with code 1 if any key is missing in any language.
 *
 * Usage (from server/): npm run check:i18n
 */

import * as fs from 'fs';
import * as path from 'path';
import { ErrorKeys } from '../../shared/src/constants/error-keys';

// ─── config ──────────────────────────────────────────────────────────────────

const I18N_DIR = path.resolve(__dirname, '../../client/src/assets/i18n');

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Recursively extract all leaf string values from an object */
function extractLeafValues(obj: unknown, prefix = ''): string[] {
  const values: string[] = [];
  if (typeof obj === 'string') {
    values.push(obj);
  } else if (typeof obj === 'object' && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      values.push(...extractLeafValues(value, prefix ? `${prefix}.${key}` : key));
    }
  }
  return values;
}

/** Resolve a dot-path (e.g. 'errors.auth.invalidCredentials') in a nested object */
function resolvePath(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ─── main ────────────────────────────────────────────────────────────────────

const errorKeyValues = extractLeafValues(ErrorKeys);

// Find all i18n JSON files
const i18nFiles = fs
  .readdirSync(I18N_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({
    name: f,
    path: path.join(I18N_DIR, f),
  }));

if (i18nFiles.length === 0) {
  console.error('❌ No i18n JSON files found in', I18N_DIR);
  process.exit(1);
}

let hasErrors = false;

for (const file of i18nFiles) {
  const content = JSON.parse(fs.readFileSync(file.path, 'utf-8')) as Record<string, unknown>;
  const missing: string[] = [];

  for (const key of errorKeyValues) {
    const value = resolvePath(content, key);
    if (value === undefined || typeof value !== 'string') {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    hasErrors = true;
    console.error(`\n❌ ${file.name}: ${missing.length} missing key(s):`);
    for (const key of missing) {
      console.error(`   - ${key}`);
    }
  } else {
    console.log(`✅ ${file.name}: all ${errorKeyValues.length} error keys present`);
  }
}

if (hasErrors) {
  console.error(
    `\n💡 Add missing keys to the i18n JSON files in ${I18N_DIR}`
  );
  process.exit(1);
} else {
  console.log(
    `\n✅ All ${errorKeyValues.length} ErrorKeys values found in ${i18nFiles.length} language file(s)`
  );
}
