/**
 * Lint check: ensures every <mat-spinner> / <mat-progress-spinner> in the
 * .html templates under src/app has an accessible name or is hidden from
 * assistive technology.
 *
 * The spinner renders role="progressbar" and sets no name by itself, so an
 * unlabelled one fails axe rule `aria-progressbar-name` whenever a scan meets a
 * loading state. Accepted on the opening tag: `aria-label`,
 * `[attr.aria-label]` or `aria-hidden`.
 *
 * Exit code 1 if violations found.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

const SPINNER_TAG = /<mat-(?:progress-)?spinner\b[^>]*>/g;
const NAMED = /\baria-(?:label|hidden)\b/;

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
  for (const match of content.matchAll(SPINNER_TAG)) {
    if (NAMED.test(match[0])) continue;
    const line = content.slice(0, match.index).split('\n').length;
    violations.push(`  ${relative(srcDir, filePath)}:${line}`);
  }
}

if (violations.length > 0) {
  console.error(
    'ERROR: loading spinner without an accessible name.\n' +
      'Add [attr.aria-label]="t(\'common.loading\')" to the opening tag,\n' +
      'or aria-hidden="true" when a visible label already names the state.\n'
  );
  console.error('Violations:');
  for (const v of violations) {
    console.error(v);
  }
  process.exit(1);
} else {
  console.log('check-spinner-labels: OK - no violations found.');
}
