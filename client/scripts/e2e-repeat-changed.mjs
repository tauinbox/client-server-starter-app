// A spec that fails in a few percent of its runs passes one run of the suite
// (feature-flags.spec.ts: 2 of 25). Not --only-changed: it also selects every
// spec that imports a changed fixture, so it would repeat the whole suite.
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPEAT = 10;
const base = process.argv[2] ?? 'origin/master';

const changed = execFileSync(
  'git',
  ['diff', '--name-only', '--relative', '--diff-filter=d', base, '--', 'e2e'],
  { cwd: CLIENT, encoding: 'utf8' }
)
  .split('\n')
  .filter((file) => file.endsWith('.spec.ts'));

if (changed.length === 0) {
  console.log(`e2e-repeat-changed: no spec differs from ${base}.`);
  process.exit(0);
}

console.log(
  `e2e-repeat-changed: ${changed.length} spec(s) differ from ${base}, ${REPEAT} runs each:\n  ${changed.join('\n  ')}`
);

const { status } = spawnSync(
  process.execPath,
  [
    resolve(CLIENT, 'node_modules/@playwright/test/cli.js'),
    'test',
    ...changed,
    `--repeat-each=${REPEAT}`,
    '--retries=0',
    // The config records a CI trace on the first retry only, and here no retry runs.
    '--trace=retain-on-failure'
  ],
  { cwd: CLIENT, stdio: 'inherit' }
);

process.exit(status ?? 1);
