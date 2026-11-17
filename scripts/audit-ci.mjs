#!/usr/bin/env node
// `npm audit` POSTs to the advisory endpoint and make-fetch-happen never
// retries POST, so one 5xx from the registry fails the gate and fetch-retries
// cannot help. Retry that case only - a real finding must fail immediately.
// Accepted risks pass only as accepted-risks.mjs decides.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  WORKSPACES,
  judgeAudit,
  readRegistry,
  todayUtc
} from './accepted-risks.mjs';

// The default fetch timeout is 300 s and `npm audit` asks two endpoints, so a
// degraded one costs up to 10 min per attempt and outlives any job budget.
// Measured against it while failing on 2026-09-04: 7m01 default, 32 s at 30 s.
// A healthy call answers in about a second, so the margin is thirty-fold.
const AUDIT_ARGS = ['audit', '--json', '--omit=dev', '--fetch-timeout=30000'];
const ENDPOINT_ERROR = 'audit endpoint returned an error';
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 15_000;

// Node refuses to spawn npm.cmd without a shell, so Windows needs shell: true.
const isWindows = process.platform === 'win32';

function npm(args) {
  return spawnSync('npm', args, {
    encoding: 'utf8',
    shell: isWindows,
    maxBuffer: 64 * 1024 * 1024
  });
}

async function runAudit() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = npm(AUDIT_ARGS);

    if (result.error) {
      console.error(`Failed to run npm audit: ${result.error.message}`);
      process.exit(1);
    }

    const output = `${result.stdout}${result.stderr}`;

    if (!output.includes(ENDPOINT_ERROR)) {
      try {
        return JSON.parse(result.stdout);
      } catch {
        process.stderr.write(output);
        console.error('npm audit did not print a JSON report.');
        process.exit(1);
      }
    }

    if (attempt === MAX_ATTEMPTS) {
      process.stderr.write(output);
      process.exit(1);
    }

    console.error(
      `\nnpm audit could not reach the advisory endpoint ` +
        `(attempt ${attempt}/${MAX_ATTEMPTS}); retrying in ${RETRY_DELAY_MS / 1000}s.`
    );
    await delay(RETRY_DELAY_MS);
  }
}

function latestVersions(packages) {
  const latest = {};

  for (const name of packages) {
    const result = npm(['view', name, 'dist-tags.latest']);

    if (result.status !== 0) {
      process.stderr.write(result.stderr);
      console.error(`Failed to read the latest release of ${name}.`);
      process.exit(1);
    }

    latest[name] = result.stdout.trim();
  }

  return latest;
}

const workspace = basename(process.cwd());

if (!WORKSPACES.includes(workspace)) {
  console.error(
    `audit-ci: run it from a workspace (${WORKSPACES.join(', ')}), not from "${workspace}".`
  );
  process.exit(1);
}

const registry = readRegistry();
const audit = await runAudit();
const lock = JSON.parse(
  readFileSync(join(process.cwd(), 'package-lock.json'), 'utf8')
);
const ownRisks = registry.risks.filter((risk) =>
  risk.workspaces.includes(workspace)
);
const latest = latestVersions([
  ...new Set(ownRisks.map((risk) => risk.package))
]);
const { blocking, covered, unused } = judgeAudit(audit, {
  workspace,
  registry,
  lock,
  today: todayUtc(),
  latest
});

for (const line of covered) console.log(`accepted: ${line}`);

if (blocking.length > 0 || unused.length > 0) {
  for (const line of blocking) console.error(`blocking: ${line}`);
  for (const line of unused) console.error(`unused: ${line}`);
  console.error(
    `\naudit-ci: ${blocking.length} blocking advisory(ies), ${unused.length} unused accepted risk(s) in the ${workspace} production tree.`
  );
  process.exit(1);
}

console.log(
  `audit-ci: no blocking advisory in the ${workspace} production tree (${covered.length} accepted).`
);
