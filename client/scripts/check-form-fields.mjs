/**
 * Lint check: ensures <mat-form-field> is only used inside the
 * app-form-field wrapper (shared/forms/) or in documented exceptions.
 *
 * Allowed locations:
 *  - shared/forms/          — the wrapper itself + tests
 *  - user-list              — mat-select filter (no text input)
 *  - user-edit              — mat-select for roles
 *  - role-permissions-dialog — mat-select fields in admin
 *  - condition-builder      — mat-select/input in admin condition builder
 *
 * Exit code 1 if violations found.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

const ALLOWED_PATTERNS = [
  /shared[\\/]forms[\\/]/,
  /user-list[\\/]/,
  /user-edit[\\/]/,
  /role-permissions-dialog[\\/]/,
  /condition-builder[\\/]/,
];

// Find all .html files under src/app
let files;
try {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '*.html'],
    { cwd: srcDir, encoding: 'utf-8' }
  );
  files = output
    .split('\n')
    .filter(Boolean)
    .filter((f) => f.startsWith('app/'))
    .map((f) => resolve(srcDir, f));
} catch {
  console.error('Failed to list files via git. Is this a git repository?');
  process.exit(2);
}

const violations = [];

for (const filePath of files) {
  const content = readFileSync(filePath, 'utf-8');
  if (!content.includes('<mat-form-field')) continue;

  const rel = relative(srcDir, filePath);
  const isAllowed = ALLOWED_PATTERNS.some((p) => p.test(rel));
  if (!isAllowed) {
    // Find line numbers
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('<mat-form-field')) {
        violations.push(`  ${rel}:${i + 1}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    'ERROR: <mat-form-field> used outside <app-form-field> wrapper.\n' +
      'Use <app-form-field> instead, or add an exception to\n' +
      'scripts/check-form-fields.mjs if this is a documented case.\n'
  );
  console.error('Violations:');
  for (const v of violations) {
    console.error(v);
  }
  process.exit(1);
} else {
  console.log('check-form-fields: OK — no violations found.');
}
