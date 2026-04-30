/**
 * Lint check: bans the M2 `color="primary|accent|warn"` attribute on Angular
 * Material elements in templates.
 *
 * Why: the project uses an M3 theme (`@include mat.theme(...)` in
 * `styles/themes/_light.scss`). In M3 these attributes are silent no-ops on
 * buttons, chips, icons, and progress spinners — visually they look the same
 * as a default-coloured component. M3 colours come from CSS variables instead
 * (e.g. `var(--mat-sys-error)`); destructive actions use the `.app-btn-danger`
 * utility from `styles/components/_buttons.scss`.
 *
 * The ALLOW_LIST below freezes files that still contain the legacy attribute
 * at the time this rule was introduced. Each migration PR removes one or
 * more files from the list; once the list is empty the constant + this
 * script can be deleted in favour of an unconditional ban.
 *
 * Exit code 1 on any new occurrence outside the allow-list, OR on stale
 * entries (file in the allow-list that no longer matches the pattern — must
 * be pruned to keep the list shrinking).
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '..', 'src');

// Files frozen with legacy `color="..."` usage. Use forward-slash POSIX paths
// relative to client/src. Migration PRs MUST remove the entry as the file is
// updated; the script fails on stale entries.
const ALLOW_LIST = new Set([
  'app/features/admin/components/resources/action-form-dialog/action-form-dialog.component.html',
  'app/features/admin/components/resources/action-list/action-list.component.html',
  'app/features/admin/components/resources/resource-form-dialog/resource-form-dialog.component.html',
  'app/features/admin/components/resources/resource-list/resource-list.component.html',
  'app/features/admin/components/roles/role-form-dialog/role-form-dialog.component.html',
  'app/features/admin/components/roles/role-list/role-list.component.html',
  'app/features/admin/components/roles/role-permissions-dialog/role-permissions-dialog.component.html',
]);

const PATTERN = /\bcolor="(?:primary|accent|warn)"/;

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
    .map((f) => ({ rel: f, abs: resolve(srcDir, f) }));
} catch {
  console.error('Failed to list files via git. Is this a git repository?');
  process.exit(2);
}

const newViolations = [];
const matchedAllowed = new Set();

for (const { rel, abs } of files) {
  const content = readFileSync(abs, 'utf-8');
  if (!PATTERN.test(content)) continue;

  const posix = rel.replaceAll('\\', '/');
  if (ALLOW_LIST.has(posix)) {
    matchedAllowed.add(posix);
    continue;
  }

  // Collect line numbers for clearer error messages.
  const lines = content.split('\n');
  const matchedLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (PATTERN.test(lines[i])) {
      matchedLines.push(i + 1);
    }
  }
  newViolations.push({ rel: posix, lines: matchedLines });
}

const staleAllowList = [...ALLOW_LIST].filter((f) => !matchedAllowed.has(f));

if (newViolations.length > 0 || staleAllowList.length > 0) {
  if (newViolations.length > 0) {
    console.error(
      'ERROR: M2-style color="primary|accent|warn" attribute detected.\n' +
        'M3 themes do not honour this attribute (silent no-op). Use one of:\n' +
        '  - drop the attribute (primary is the default)\n' +
        '  - apply class="app-btn-danger" for destructive buttons\n' +
        '  - apply class="app-chip-danger" for destructive chips\n' +
        'See styles/components/_buttons.scss and _chips.scss.\n'
    );
    console.error('New violations:');
    for (const v of newViolations) {
      console.error(`  ${v.rel}:${v.lines.join(',')}`);
    }
  }

  if (staleAllowList.length > 0) {
    console.error(
      '\nERROR: stale entries in ALLOW_LIST (file no longer contains the\n' +
        'banned attribute). Remove these from scripts/check-mat-color-attr.mjs\n' +
        'so the list keeps shrinking:\n'
    );
    for (const s of staleAllowList) {
      console.error(`  ${s}`);
    }
  }

  process.exit(1);
}

console.log(
  `check-mat-color-attr: OK — ${matchedAllowed.size}/${ALLOW_LIST.size} ` +
    'allow-listed files still pending migration.'
);
