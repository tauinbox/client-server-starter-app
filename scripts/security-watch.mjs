/**
 * Daily dependency watch, run by .github/workflows/security-watch.yml on
 * master. A gate runs only when somebody pushes, so a new advisory, a fixed
 * release or an expired accepted risk can wait unseen; this run finds them
 * within a day.
 *
 * It runs the production gate (audit-ci.mjs) and the registry check in each
 * workspace, and lists the high and critical advisories of the dev trees,
 * which no gate blocks. On a failed gate it opens or updates one issue with
 * the label below and exits 1; when every gate passes it closes that issue.
 * `--dry-run` prints the report and touches no issue.
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  GATE_SEVERITIES,
  ROOT,
  WORKSPACES,
  collectAdvisories,
  readAuditReport
} from './accepted-risks.mjs';

const LABEL = 'security-watch';
const TITLE = 'Dependency gate fails on master';
const dryRun = process.argv.includes('--dry-run');
const isWindows = process.platform === 'win32';

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: isWindows && command !== 'node',
    maxBuffer: 64 * 1024 * 1024
  });

  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
    stdout: result.stdout ?? ''
  };
}

function gateAdvisories(cwd, extraArgs) {
  const { report, problem } = readAuditReport(
    run('npm', ['audit', '--json', ...extraArgs], cwd)
  );

  if (problem !== undefined) return undefined;

  return [...collectAdvisories(report).values()].filter((advisory) =>
    GATE_SEVERITIES.has(advisory.severity)
  );
}

function devOnlyReport(cwd) {
  const all = gateAdvisories(cwd, []);
  const production = gateAdvisories(cwd, ['--omit=dev']);

  if (!all || !production) return '- could not read `npm audit`';

  const productionIds = new Set(production.map((advisory) => advisory.id));
  const devOnly = all.filter((advisory) => !productionIds.has(advisory.id));

  return devOnly.length === 0
    ? '- none'
    : devOnly
        .map(
          (advisory) =>
            `- [${advisory.id}](${advisory.url}) ${advisory.severity}: ${[...advisory.packages].join(', ')} ${advisory.range}`
        )
        .join('\n');
}

const sections = [];
let failed = false;

const registry = run('node', [join(ROOT, 'scripts/check-accepted-risks.mjs')]);

if (registry.status !== 0) failed = true;

sections.push(
  `## Accepted-risk registry: ${registry.status === 0 ? 'OK' : 'FAILED'}\n\n\`\`\`\n${registry.output}\n\`\`\``
);

for (const workspace of WORKSPACES) {
  const cwd = join(ROOT, workspace);
  const gate = run('node', [join(ROOT, 'scripts/audit-ci.mjs')], cwd);

  if (gate.status !== 0) failed = true;

  sections.push(
    `## \`${workspace}\`: production gate ${gate.status === 0 ? 'passes' : 'FAILS'}\n\n\`\`\`\n${gate.output}\n\`\`\`\n\nHigh and critical advisories in the dev tree only (no gate blocks them):\n\n${devOnlyReport(cwd)}`
  );
}

const body = `${sections.join('\n\n')}\n\n_Written by the daily security watch._\n`;

console.log(body);

if (dryRun) process.exit(failed ? 1 : 0);

const open = run('gh', [
  'issue',
  'list',
  '--state',
  'open',
  '--label',
  LABEL,
  '--json',
  'number',
  '--jq',
  '.[0].number'
]).stdout.trim();

if (failed) {
  run('gh', [
    'label',
    'create',
    LABEL,
    '--color',
    'B60205',
    '--description',
    'The daily dependency watch found a failing gate'
  ]);

  const result = open
    ? run('gh', ['issue', 'edit', open, '--body', body])
    : run('gh', [
        'issue',
        'create',
        '--title',
        TITLE,
        '--label',
        LABEL,
        '--body',
        body
      ]);

  console.log(result.output);

  if (result.status !== 0)
    console.error('security-watch: could not write the issue.');

  process.exit(1);
}

if (open) {
  const result = run('gh', [
    'issue',
    'close',
    open,
    '--comment',
    'Every dependency gate passes on master again.'
  ]);

  console.log(result.output);
}

console.log('security-watch: every dependency gate passes.');
