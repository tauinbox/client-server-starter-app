/**
 * Lint check for the translation keys under src.
 *
 * 1. Every single-quoted key in a .ts or .html file (spec files excluded: they
 *    use made-up keys on purpose) resolves to a text in both the en.json and
 *    the ru.json of its scope. A key starts with the name of a feature scope
 *    (src/app/features/<scope>/i18n) or with a top-level key of the root files
 *    (src/assets/i18n). A literal that ends with "." or "_" is the prefix of a
 *    dynamic key: it must resolve to a group, or to the start of a key name.
 * 2. The en.json and the ru.json of each scope hold the same keys.
 * 3. Message keys follow one naming form: a failure is error<X>Failed, a
 *    success is success<Result>, and a feature file has no "errors" group at
 *    any depth. The root "errors" group holds the server error keys and is
 *    exempt from the names; the root "forms.errors" group is shared.
 *
 * Exit code 1 if violations found.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

const LITERAL = /'([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_-]+)*\.?)'/g;
const FEATURE_I18N = /^app\/features\/([^/]+)\/i18n\/(en|ru)\.json$/;
const ROOT_I18N = /^assets\/i18n\/(en|ru)\.json$/;

let files;
try {
  files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: srcDir, encoding: 'utf-8' }
  )
    .split('\n')
    .filter(Boolean);
} catch {
  console.error('Failed to list files via git. Is this a git repository?');
  process.exit(2);
}

const readJson = (file) =>
  JSON.parse(readFileSync(resolve(srcDir, file), 'utf-8'));

// scope name ('' for root) -> { en, ru }
const scopes = new Map();
for (const file of files) {
  const feature = FEATURE_I18N.exec(file);
  const root = ROOT_I18N.exec(file);
  if (!feature && !root) continue;
  const scope = feature ? feature[1] : '';
  const lang = feature ? feature[2] : root[1];
  const entry = scopes.get(scope) ?? {};
  entry[lang] = { file, json: readJson(file) };
  scopes.set(scope, entry);
}

const violations = [];

const leafPaths = (node, path = '') =>
  Object.entries(node).flatMap(([key, value]) => {
    const keyPath = path ? `${path}.${key}` : key;
    return typeof value === 'string' ? [keyPath] : leafPaths(value, keyPath);
  });

const lookup = (node, path) =>
  path.split('.').reduce((current, part) => current?.[part], node);

// 2. en/ru parity
for (const [scope, { en, ru }] of scopes) {
  const name = scope || 'root';
  if (!en || !ru) {
    violations.push(`  ${name}: en.json and ru.json must both exist`);
    continue;
  }
  const enKeys = new Set(leafPaths(en.json));
  const ruKeys = new Set(leafPaths(ru.json));
  for (const key of enKeys) {
    if (!ruKeys.has(key)) violations.push(`  ${ru.file}  missing ${key}`);
  }
  for (const key of ruKeys) {
    if (!enKeys.has(key)) violations.push(`  ${en.file}  missing ${key}`);
  }
}

// 3. message key names
for (const [scope, { en }] of scopes) {
  if (!en) continue;
  const errorGroups = new Set();
  for (const path of leafPaths(en.json)) {
    if (!scope && path.startsWith('errors.')) continue;
    const parts = path.split('.');
    const leaf = parts.pop();
    const index = parts.indexOf('errors');
    if (scope && index !== -1) {
      errorGroups.add(parts.slice(0, index + 1).join('.'));
    }
    if (/Failed$/.test(leaf) && !leaf.startsWith('error')) {
      violations.push(`  ${en.file}  ${path}: name it error<X>Failed`);
    }
    if (/Success$|^success$/.test(leaf)) {
      violations.push(`  ${en.file}  ${path}: name it success<Result>`);
    }
  }
  for (const group of errorGroups) {
    violations.push(
      `  ${en.file}  ${group}: no "errors" group in a feature; put error<X> keys in the section that shows them`
    );
  }
}

// 1. literal keys resolve
const rootGroups = new Set(Object.keys(scopes.get('')?.en?.json ?? {}));
const resolvesIn = (json, path, literal) => {
  if (literal.endsWith('.')) {
    const value = lookup(json, path.slice(0, -1));
    return typeof value === 'object' && value !== null;
  }
  if (literal.endsWith('_')) {
    const parts = path.split('.');
    const stem = parts.pop();
    const group = parts.length > 0 ? lookup(json, parts.join('.')) : json;
    return (
      typeof group === 'object' &&
      group !== null &&
      Object.keys(group).some((name) => name.startsWith(stem))
    );
  }
  return typeof lookup(json, path) === 'string';
};

const resolveKey = (literal) => {
  const key = literal.endsWith('.') ? literal.slice(0, -1) : literal;
  const [first, ...rest] = key.split('.');
  let scope;
  let path;
  if (scopes.has(first) && first !== '') {
    if (rest.length === 0) return null;
    scope = first;
    path = literal.slice(first.length + 1);
  } else if (rootGroups.has(first) && rest.length > 0) {
    scope = '';
    path = literal;
  } else {
    return null;
  }
  const { en, ru } = scopes.get(scope);
  return [en, ru]
    .filter(Boolean)
    .filter(({ json }) => !resolvesIn(json, path, literal))
    .map(({ file }) => file);
};

for (const file of files) {
  if (!/\.(ts|html)$/.test(file) || file.endsWith('.spec.ts')) continue;
  const lines = readFileSync(resolve(srcDir, file), 'utf-8').split('\n');
  lines.forEach((line, index) => {
    for (const [, literal] of line.matchAll(LITERAL)) {
      if (!literal.includes('.')) continue;
      const missingIn = resolveKey(literal);
      if (missingIn && missingIn.length > 0) {
        violations.push(
          `  ${file}:${index + 1}  '${literal}' not in ${missingIn.join(', ')}`
        );
      }
    }
  });
}

if (violations.length > 0) {
  console.error(
    'ERROR: translation keys are out of sync.\n' +
      'A key used in the code must exist in en.json and ru.json of its scope,\n' +
      'both files must hold the same keys, and message keys are named\n' +
      'error<X>Failed / success<Result>.\n'
  );
  console.error('Violations:');
  for (const v of violations) {
    console.error(v);
  }
  process.exit(1);
} else {
  console.log('check-i18n-keys: OK - no violations found.');
}
