/**
 * Refuses an HTTP status number in a source comment. The status of an error
 * key lives in `ERROR_STATUS` only, so a comment names the key or describes
 * the answer in words. A number in a comment stays behind when the key changes
 * its status, and nothing fails.
 *
 * Scans `server/src`, `mock-server/src` and `shared/src`. Spec files and
 * `__tests__` are skipped: a test asserts a status by design. An
 * `eslint-disable` line is skipped: its reason describes the directive. The
 * files in `TRANSPORT_FILES` describe the transport layer itself and may name
 * statuses.
 *
 * The status numbers come from `HTTP_STATUS_TEXT`, so a new status needs no
 * edit here.
 *
 * `--self-test` runs the detector on planted comments and fails if it stays
 * silent. Exit code 1 if violations are found.
 */

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOTS = ['server/src', 'mock-server/src', 'shared/src'];
const STATUS_SOURCE = 'shared/src/constants/http-status.constants.ts';

const TRANSPORT_FILES = new Set([
  'shared/src/constants/error-status.ts',
  'shared/src/constants/http-status.constants.ts',
  'server/src/common/pipes/api-validation.pipe.ts',
  'server/src/modules/core/filters/global-exception.filter.ts',
  'mock-server/src/helpers/error-envelope.helpers.ts',
  'mock-server/src/helpers/validation-error.helpers.ts',
  'mock-server/src/helpers/list-query.helpers.ts',
  'mock-server/src/helpers/pagination.helpers.ts'
]);

const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__']);

function readStatuses(file) {
  const text = readFileSync(file, 'utf8');
  const statuses = [...text.matchAll(/^\s*(\d{3}):\s*'/gm)].map((m) => m[1]);
  if (statuses.length === 0) {
    console.error(`ERROR: check-status-comments found no status in ${file}.`);
    process.exit(1);
  }
  return statuses;
}

function commentPattern(statuses) {
  const numbers = `\\b(${statuses.join('|')})\\b`;
  // A line that is a comment, or a trailing `// ` comment after code.
  return new RegExp(
    `^\\s*(\\/\\/|\\/\\*|\\*).*${numbers}|\\s\\/\\/\\s.*${numbers}`
  );
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

function toRepoPath(base, file) {
  return relative(base, file).split(sep).join('/');
}

function scan(base, roots, pattern) {
  const violations = [];
  for (const root of roots) {
    for (const file of walk(join(base, root))) {
      const repoPath = toRepoPath(base, file);
      if (TRANSPORT_FILES.has(repoPath)) continue;
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (line.includes('eslint-disable')) return;
        if (pattern.test(line)) {
          violations.push(`${repoPath}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  }
  return violations;
}

function selfTest(pattern) {
  const base = mkdtempSync(join(tmpdir(), 'check-status-comments-'));
  try {
    mkdirSync(join(base, 'src'));
    writeFileSync(
      join(base, 'src', 'planted.ts'),
      [
        '// a missing row answers 404 here',
        '/**',
        ' * Throws 422 when the body is wrong.',
        ' */',
        'const x = 1; // 409 on a duplicate',
        '// eslint-disable-next-line no-restricted-syntax -- a 500 programmer error',
        "const url = 'http://host:4000/a';",
        '// the cap is 4000 items'
      ].join('\n')
    );
    writeFileSync(join(base, 'src', 'planted.spec.ts'), '// answers 404\n');
    const found = scan(base, ['src'], pattern).map((v) => v.split(':')[1]);
    const expected = ['1', '3', '5'];
    if (found.join(',') !== expected.join(',')) {
      console.error(
        `ERROR: check-status-comments self-test failed: expected lines ${expected.join(', ')}, got ${found.join(', ') || 'none'}.`
      );
      process.exit(1);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  console.log('check-status-comments: self-test OK.');
}

const pattern = commentPattern(readStatuses(join(ROOT, STATUS_SOURCE)));

if (process.argv.includes('--self-test')) {
  selfTest(pattern);
} else {
  const violations = scan(ROOT, SCAN_ROOTS, pattern);
  if (violations.length > 0) {
    console.error(
      'ERROR: a comment names an HTTP status. Name the error key, or describe the answer in words; the status lives in ERROR_STATUS:\n' +
        violations.map((v) => `  ${v}`).join('\n')
    );
    process.exit(1);
  }
  console.log('check-status-comments: no HTTP status in a comment.');
}
