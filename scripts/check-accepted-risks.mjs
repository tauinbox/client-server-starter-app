/**
 * Static check of the accepted dependency risks (security/accepted-risks.json).
 * Zero dependencies apart from git and, in a pull request, the gh CLI.
 *
 *   (no flag)     validate the registry and compare .trivyignore.yaml with it
 *   --write       write .trivyignore.yaml from the registry
 *   --base <ref>  also refuse an added or changed entry in a pull request that
 *                 has no "accepted-risk" label. Only a maintainer can set a
 *                 label, so no entry reaches master without that decision.
 *                 Outside a pull request (PR_NUMBER unset) it only prints them.
 *   --self-test   run every rule against synthetic input
 *
 * The live part of the rules (the advisory still blocks, no fix, no newer
 * release) needs the registry of npm: `audit-ci.mjs` applies it.
 *
 * Exit code 1 on any problem.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REGISTRY_FILE,
  ROOT,
  TRIVYIGNORE_FILE,
  auditReportProblem,
  changedRisks,
  judgeAudit,
  parseRegistry,
  readRegistry,
  todayUtc,
  trivyignoreYaml,
  validateRegistry
} from './accepted-risks.mjs';

const APPROVAL_LABEL = 'accepted-risk';

function readGuard(file) {
  const path = join(ROOT, file);

  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

function readBaseRegistry(ref) {
  try {
    return parseRegistry(
      execFileSync('git', ['show', `${ref}:${REGISTRY_FILE}`], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      })
    );
  } catch {
    return { risks: [] };
  }
}

function pullRequestLabels(number) {
  const output = execFileSync(
    'gh',
    ['pr', 'view', number, '--json', 'labels', '--jq', '.labels[].name'],
    { cwd: ROOT, encoding: 'utf8' }
  );

  return output.split('\n').filter(Boolean);
}

function approvalProblems(base, next) {
  const changed = changedRisks(base, next);

  if (changed.length === 0) return [];

  const ids = changed.map((risk) => risk.id).join(', ');
  const number = process.env.PR_NUMBER;

  if (!number) {
    console.log(
      `check-accepted-risks: this change adds or changes ${ids}; its pull request needs the "${APPROVAL_LABEL}" label.`
    );
    return [];
  }

  return pullRequestLabels(number).includes(APPROVAL_LABEL)
    ? []
    : [
        `pull request #${number} adds or changes ${ids} in ${REGISTRY_FILE}. A maintainer accepts the risk by setting the "${APPROVAL_LABEL}" label, then re-runs this job.`
      ];
}

function run(args) {
  const registry = readRegistry();
  const expectedYaml = trivyignoreYaml(registry);

  if (args.includes('--write')) {
    writeFileSync(join(ROOT, TRIVYIGNORE_FILE), expectedYaml);
    console.log(`check-accepted-risks: wrote ${TRIVYIGNORE_FILE}.`);
  }

  const problems = validateRegistry(registry, { today: todayUtc(), readGuard });
  const yamlPath = join(ROOT, TRIVYIGNORE_FILE);

  if (
    !existsSync(yamlPath) ||
    readFileSync(yamlPath, 'utf8') !== expectedYaml
  ) {
    problems.push(
      `${TRIVYIGNORE_FILE} does not match ${REGISTRY_FILE}: run \`npm run check:accepted-risks -- --write\` in server/.`
    );
  }

  const baseIndex = args.indexOf('--base');

  if (baseIndex !== -1) {
    const ref = args[baseIndex + 1];

    if (!ref) {
      problems.push('--base needs a git ref');
    } else {
      problems.push(...approvalProblems(readBaseRegistry(ref), registry));
    }
  }

  if (problems.length > 0) {
    console.error(`check-accepted-risks: ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log(
    `check-accepted-risks: OK - ${registry.risks.length} accepted risk(s).`
  );
}

// ---------------------------------------------------------------- self-test

const TODAY = '2026-11-17';
const GUARD_FILE = 'server/src/example.spec.ts';
const GUARD_TEST = 'never calls the matcher';

function sampleRisk(overrides = {}) {
  return {
    id: 'GHSA-fc5q-39xc-vjpf',
    aliases: ['CVE-2026-112366'],
    package: 'picomatch',
    version: '4.0.7',
    workspaces: ['server'],
    affected: ['picomatch', 'fdir', 'tinyglobby', 'typeorm'],
    reachability:
      'Only typeorm calls it, with no pattern that a request can supply.',
    guard: { file: GUARD_FILE, test: GUARD_TEST },
    added: '2026-11-17',
    expires: '2026-12-17',
    ...overrides
  };
}

function sampleAudit({
  fixAvailable = { name: 'typeorm', version: '0.3.31', isSemVerMajor: true },
  extraEffect,
  severity = 'high'
} = {}) {
  const advisory = {
    source: 1,
    name: 'picomatch',
    title: 'ReDoS',
    url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
    severity,
    range: '<=4.0.7'
  };

  return {
    vulnerabilities: {
      picomatch: {
        severity,
        via: [advisory],
        effects: ['fdir', 'tinyglobby'],
        nodes: ['node_modules/picomatch'],
        fixAvailable
      },
      fdir: {
        severity,
        via: ['picomatch'],
        effects: ['tinyglobby'],
        nodes: ['node_modules/fdir'],
        fixAvailable
      },
      tinyglobby: {
        severity,
        via: ['fdir', 'picomatch'],
        effects: ['typeorm', ...(extraEffect ? [extraEffect] : [])],
        nodes: ['node_modules/tinyglobby'],
        fixAvailable
      },
      typeorm: {
        severity,
        via: ['tinyglobby'],
        effects: [],
        nodes: ['node_modules/typeorm'],
        fixAvailable
      },
      ...(extraEffect
        ? {
            [extraEffect]: {
              severity,
              via: ['tinyglobby'],
              effects: [],
              nodes: [`node_modules/${extraEffect}`],
              fixAvailable
            }
          }
        : {})
    }
  };
}

const LOCK = { packages: { 'node_modules/picomatch': { version: '4.0.7' } } };

function selfTest() {
  const failures = [];
  const expect = (name, condition) => {
    if (!condition) failures.push(name);
  };
  const readSampleGuard = (file) =>
    file === GUARD_FILE ? `it('${GUARD_TEST}', ...)` : undefined;
  const problemsOf = (risk) =>
    validateRegistry(
      { risks: [risk] },
      { today: TODAY, readGuard: readSampleGuard }
    );

  expect('a valid entry passes', problemsOf(sampleRisk()).length === 0);

  const refusals = {
    'an unknown field': sampleRisk({ note: 'x' }),
    'a non-GHSA id': sampleRisk({ id: 'CVE-2026-112366' }),
    'a bad alias': sampleRisk({ aliases: ['nope'] }),
    'a range as the version': sampleRisk({ version: '^4.0.7' }),
    'an unknown workspace': sampleRisk({ workspaces: ['docs'] }),
    'a duplicated workspace': sampleRisk({ workspaces: ['server', 'server'] }),
    'affected without the package': sampleRisk({ affected: ['fdir'] }),
    'a short reachability': sampleRisk({ reachability: 'safe' }),
    'a missing guard file': sampleRisk({
      guard: { file: 'missing.spec.ts', test: GUARD_TEST }
    }),
    'a guard test that is not in the file': sampleRisk({
      guard: { file: GUARD_FILE, test: 'other' }
    }),
    'a lifetime over the limit': sampleRisk({ expires: '2026-12-18' }),
    'expires before added': sampleRisk({ expires: '2026-11-16' }),
    'an expired entry': sampleRisk({
      added: '2026-10-01',
      expires: '2026-10-31'
    }),
    'a bad date': sampleRisk({ added: '2026-13-01' })
  };

  for (const [name, risk] of Object.entries(refusals)) {
    expect(`refuses ${name}`, problemsOf(risk).length > 0);
  }

  expect(
    'refuses an id listed twice',
    validateRegistry(
      { risks: [sampleRisk(), sampleRisk()] },
      { today: TODAY, readGuard: readSampleGuard }
    ).length > 0
  );

  const judge = (
    audit,
    {
      risks = [sampleRisk()],
      latest = { picomatch: '4.0.7' },
      workspace = 'server',
      lock = LOCK
    } = {}
  ) =>
    judgeAudit(audit, {
      workspace,
      registry: { risks },
      lock,
      today: TODAY,
      latest
    });

  const covered = judge(sampleAudit());
  expect(
    'covers the exact advisory',
    covered.blocking.length === 0 &&
      covered.unused.length === 0 &&
      covered.covered.length === 1
  );
  expect(
    'blocks with no entry',
    judge(sampleAudit(), { risks: [] }).blocking.length === 1
  );
  expect(
    'blocks in another workspace',
    judge(sampleAudit(), { workspace: 'client' }).blocking.length === 1
  );
  expect(
    'blocks on a new affected package',
    judge(sampleAudit({ extraEffect: 'glob-user' })).blocking.length === 1
  );
  expect(
    'blocks on an expired entry',
    judge(sampleAudit(), {
      risks: [sampleRisk({ added: '2026-10-01', expires: '2026-10-31' })]
    }).blocking.length === 1
  );
  expect(
    'blocks on another installed version',
    judge(sampleAudit(), {
      lock: { packages: { 'node_modules/picomatch': { version: '4.0.6' } } }
    }).blocking.length === 1
  );
  expect(
    'blocks when npm reports a non-major fix',
    judge(sampleAudit({ fixAvailable: true })).blocking.length === 1
  );
  expect(
    'blocks on a newer release',
    judge(sampleAudit(), { latest: { picomatch: '4.0.8' } }).blocking.length ===
      1
  );
  expect(
    'reports an unused entry',
    judge({ vulnerabilities: {} }).unused.length === 1
  );
  expect(
    'reports an entry whose advisory is below the gate',
    judge(sampleAudit({ severity: 'moderate' })).unused.length === 1
  );
  expect(
    'ignores a moderate advisory with no entry',
    judge(sampleAudit({ severity: 'moderate' }), { risks: [] }).blocking
      .length === 0
  );

  const counted = (total) => ({
    vulnerabilities: {},
    metadata: { vulnerabilities: { total } }
  });
  expect(
    'accepts a clean report',
    auditReportProblem(counted(0), 0) === undefined
  );
  expect(
    'accepts a report with findings and exit 1',
    auditReportProblem(counted(3), 1) === undefined
  );
  expect(
    'fails closed on no JSON',
    auditReportProblem(undefined, 1) !== undefined
  );
  expect(
    'fails closed on an npm error object',
    auditReportProblem({ message: 'x', error: { summary: '' } }, 1) !==
      undefined
  );
  expect(
    'fails closed on no vulnerabilities object',
    auditReportProblem({ metadata: { vulnerabilities: { total: 0 } } }, 0) !==
      undefined
  );
  expect(
    'fails closed on no count block',
    auditReportProblem({ vulnerabilities: {} }, 0) !== undefined
  );
  expect(
    'fails closed on exit 1 with nothing counted',
    auditReportProblem(counted(0), 1) !== undefined
  );

  const yaml = trivyignoreYaml({ risks: [sampleRisk()] });
  expect(
    'writes both identifiers to Trivy',
    yaml.includes('- id: GHSA-fc5q-39xc-vjpf') &&
      yaml.includes('- id: CVE-2026-112366')
  );
  expect(
    'pins the Trivy purl to the version',
    yaml.includes('"pkg:npm/picomatch@4.0.7"')
  );
  expect(
    'gives Trivy the expiry date',
    yaml.includes('expired_at: 2026-12-17')
  );
  expect(
    'encodes a scoped purl',
    trivyignoreYaml({ risks: [sampleRisk({ package: '@a/b' })] }).includes(
      'pkg:npm/%40a/b@4.0.7'
    )
  );
  expect(
    'writes an empty Trivy list',
    trivyignoreYaml({ risks: [] }).includes('vulnerabilities: []')
  );

  expect(
    'finds an added entry',
    changedRisks({ risks: [] }, { risks: [sampleRisk()] }).length === 1
  );
  expect(
    'finds a changed entry',
    changedRisks(
      { risks: [sampleRisk()] },
      { risks: [sampleRisk({ expires: '2026-12-10' })] }
    ).length === 1
  );
  expect(
    'ignores an unchanged entry',
    changedRisks({ risks: [sampleRisk()] }, { risks: [sampleRisk()] })
      .length === 0
  );
  expect(
    'ignores a removed entry',
    changedRisks({ risks: [sampleRisk()] }, { risks: [] }).length === 0
  );

  if (failures.length > 0) {
    console.error(
      `check-accepted-risks: self-test FAILED, ${failures.length} rule(s) did not report:`
    );
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log(
    `check-accepted-risks: self-test OK, ${Object.keys(refusals).length + 1} schema refusals and every gate rule reported.`
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run(process.argv.slice(2));
}
