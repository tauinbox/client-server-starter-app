#!/usr/bin/env node
// `npm audit` POSTs to the advisory endpoint and make-fetch-happen never
// retries POST, so one 5xx from the registry fails the gate and fetch-retries
// cannot help. Retry that case only - a real finding must fail immediately.
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// The default fetch timeout is 300 s and `npm audit` asks two endpoints, so a
// degraded one costs up to 10 min per attempt and outlives any job budget.
// Measured against it while failing on 2026-09-04: 7m01 default, 32 s at 30 s.
// A healthy call answers in about a second, so the margin is thirty-fold.
const AUDIT_ARGS = [
  'audit',
  '--audit-level=high',
  '--omit=dev',
  '--fetch-timeout=30000'
];
const ENDPOINT_ERROR = 'audit endpoint returned an error';
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 15_000;

// Node refuses to spawn npm.cmd without a shell, so Windows needs shell: true.
const isWindows = process.platform === 'win32';

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const result = spawnSync('npm', AUDIT_ARGS, {
    encoding: 'utf8',
    shell: isWindows
  });

  if (result.error) {
    console.error(`Failed to run npm audit: ${result.error.message}`);
    process.exit(1);
  }

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);

  if (result.status === 0) {
    process.exit(0);
  }

  const registryUnavailable = `${result.stdout}${result.stderr}`.includes(
    ENDPOINT_ERROR
  );

  if (!registryUnavailable || attempt === MAX_ATTEMPTS) {
    process.exit(result.status ?? 1);
  }

  console.error(
    `\nnpm audit could not reach the advisory endpoint ` +
      `(attempt ${attempt}/${MAX_ATTEMPTS}); retrying in ${RETRY_DELAY_MS / 1000}s.`
  );
  await delay(RETRY_DELAY_MS);
}
