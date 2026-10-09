/**
 * Lint check: ensures every English label, title and button text in the
 * en.json translation files under src is in sentence case.
 *
 * A value with no sentence punctuation is a label. In a label, only the first
 * word starts with a capital letter, unless the word is a proper noun or the
 * name of a UI control in ALLOWED_CAPITALISED.
 *
 * Exit code 1 if violations found.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

const ALLOWED_CAPITALISED = new Set(['Enter', 'If-Match', 'MongoQuery']);
const SENTENCE_PUNCTUATION = /[.!?:;"—]/;
const PLACEHOLDER = /\{\{[^}]*\}\}/g;
const CAPITALISED = /^\(?([A-Z][a-z][\w-]*)/;

let files;
try {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '*en.json'],
    { cwd: srcDir, encoding: 'utf-8' }
  );
  files = output
    .split('\n')
    .filter((f) => f.endsWith('i18n/en.json'))
    .map((f) => resolve(srcDir, f));
} catch {
  console.error('Failed to list files via git. Is this a git repository?');
  process.exit(2);
}

const violations = [];

const visit = (node, path, file) => {
  for (const [key, value] of Object.entries(node)) {
    const keyPath = path ? `${path}.${key}` : key;
    if (typeof value !== 'string') {
      visit(value, keyPath, file);
      continue;
    }
    const text = value.replace(PLACEHOLDER, '');
    if (SENTENCE_PUNCTUATION.test(text)) continue;
    const capitalised = text
      .split(/\s+/)
      .slice(1)
      .map((word) => CAPITALISED.exec(word)?.[1])
      .filter((word) => word && !ALLOWED_CAPITALISED.has(word));
    if (capitalised.length > 0) {
      violations.push(`  ${relative(srcDir, file)}  ${keyPath} = "${value}"`);
    }
  }
};

for (const file of files) {
  visit(JSON.parse(readFileSync(file, 'utf-8')), '', file);
}

if (violations.length > 0) {
  console.error(
    'ERROR: English label not in sentence case.\n' +
      'Capitalise only the first word ("Edit role", not "Edit Role").\n' +
      'If a later word is a proper noun, add it to ALLOWED_CAPITALISED.\n'
  );
  console.error('Violations:');
  for (const v of violations) {
    console.error(v);
  }
  process.exit(1);
} else {
  console.log('check-i18n-case: OK - no violations found.');
}
