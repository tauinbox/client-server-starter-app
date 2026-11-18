/**
 * The registry of accepted dependency risks: security/accepted-risks.json.
 * Zero dependencies.
 *
 * An entry lets the dependency gates pass ONE advisory in ONE set of affected
 * packages for a limited time, when no fixed version exists and the
 * vulnerable code is not reachable. `audit-ci.mjs` reads it for `npm audit`,
 * and `.trivyignore.yaml` is generated from it for the Trivy image scans, so
 * the two gates cannot disagree.
 *
 * An entry stops passing its advisory, and the gate fails, when:
 *   - its `expires` date is past, or it lives more than MAX_LIFETIME_DAYS;
 *   - the set of affected packages is not exactly `affected`;
 *   - the installed version is not `version`;
 *   - npm reports a fix that is not a major change;
 *   - the registry has a newer `latest` release of the package;
 *   - the advisory no longer blocks (the entry is then unused).
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REGISTRY_FILE = 'security/accepted-risks.json';
export const TRIVYIGNORE_FILE = '.trivyignore.yaml';
export const WORKSPACES = ['client', 'server', 'mock-server'];
export const MAX_LIFETIME_DAYS = 30;
export const GATE_SEVERITIES = new Set(['high', 'critical']);

const ENTRY_KEYS = [
  'id',
  'aliases',
  'package',
  'version',
  'workspaces',
  'affected',
  'reachability',
  'guard',
  'added',
  'expires'
];
const GHSA_ID = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/;
const CVE_ID = /^CVE-\d{4}-\d{4,}$/;
const VERSION = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const MIN_REACHABILITY_LENGTH = 40;

export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function isDate(value) {
  return (
    typeof value === 'string' &&
    DATE.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

function daysBetween(from, to) {
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS
  );
}

function isStringArray(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.length > 0)
  );
}

export function readRegistry(root = ROOT) {
  return parseRegistry(readFileSync(join(root, REGISTRY_FILE), 'utf8'));
}

export function parseRegistry(text) {
  const registry = JSON.parse(text);

  if (!registry || !Array.isArray(registry.risks)) {
    throw new Error(
      `${REGISTRY_FILE}: expected an object with a "risks" array`
    );
  }

  return registry;
}

/**
 * Static checks of the registry. `readGuard(file)` returns the text of a guard
 * file, or undefined when it does not exist.
 */
export function validateRegistry(registry, { today, readGuard }) {
  const problems = [];
  const seen = new Set();

  for (const [index, risk] of registry.risks.entries()) {
    const at = `risks[${index}] (${risk?.id ?? 'no id'})`;
    const fail = (message) => problems.push(`${at}: ${message}`);

    if (!risk || typeof risk !== 'object') {
      fail('is not an object');
      continue;
    }

    for (const key of Object.keys(risk)) {
      if (!ENTRY_KEYS.includes(key)) fail(`unknown field "${key}"`);
    }

    if (!GHSA_ID.test(risk.id ?? '')) fail('"id" is not a GHSA identifier');
    if (seen.has(risk.id)) fail('"id" is listed twice');
    seen.add(risk.id);

    if (
      !Array.isArray(risk.aliases) ||
      !risk.aliases.every((alias) => CVE_ID.test(alias) || GHSA_ID.test(alias))
    ) {
      fail('"aliases" must be an array of CVE or GHSA identifiers');
    }

    if (typeof risk.package !== 'string' || risk.package.length === 0) {
      fail('"package" is missing');
    }

    if (!VERSION.test(risk.version ?? ''))
      fail('"version" is not an exact version');

    if (
      !isStringArray(risk.workspaces) ||
      !risk.workspaces.every((name) => WORKSPACES.includes(name)) ||
      new Set(risk.workspaces).size !== risk.workspaces.length
    ) {
      fail(
        `"workspaces" must be distinct names from: ${WORKSPACES.join(', ')}`
      );
    }

    if (
      !isStringArray(risk.affected) ||
      !risk.affected.includes(risk.package) ||
      new Set(risk.affected).size !== risk.affected.length
    ) {
      fail(
        '"affected" must list distinct package names, the vulnerable package included'
      );
    }

    if (
      typeof risk.reachability !== 'string' ||
      risk.reachability.trim().length < MIN_REACHABILITY_LENGTH
    ) {
      fail(
        '"reachability" must state why the vulnerable code cannot be reached'
      );
    }

    const { file, test } = risk.guard ?? {};

    if (
      typeof file !== 'string' ||
      typeof test !== 'string' ||
      test.length === 0
    ) {
      fail(
        '"guard" must be { "file": <repository path>, "test": <test title> }'
      );
    } else {
      const text = readGuard(file);

      if (text === undefined) fail(`guard file "${file}" does not exist`);
      else if (!text.includes(test))
        fail(`guard file "${file}" has no test "${test}"`);
    }

    if (!isDate(risk.added) || !isDate(risk.expires)) {
      fail('"added" and "expires" must be YYYY-MM-DD dates');
    } else {
      const lifetime = daysBetween(risk.added, risk.expires);

      if (lifetime < 0) fail('"expires" is before "added"');
      if (lifetime > MAX_LIFETIME_DAYS) {
        fail(`lives ${lifetime} days; the limit is ${MAX_LIFETIME_DAYS}`);
      }
      if (risk.expires < today) fail(`expired on ${risk.expires}`);
    }
  }

  return problems;
}

function advisoryId(via) {
  return typeof via.url === 'string'
    ? via.url.split('/').at(-1)
    : String(via.source);
}

/** Collects the advisories of an `npm audit --json` report with their affected packages. */
export function collectAdvisories(audit) {
  const vulnerabilities = audit?.vulnerabilities ?? {};
  const advisories = new Map();

  for (const [name, entry] of Object.entries(vulnerabilities)) {
    for (const via of entry.via ?? []) {
      if (typeof via !== 'object' || via === null) continue;

      const id = advisoryId(via);
      const advisory = advisories.get(id) ?? {
        id,
        title: via.title ?? '',
        url: via.url ?? '',
        severity: via.severity,
        range: via.range,
        packages: new Set()
      };

      advisory.packages.add(name);
      advisories.set(id, advisory);
    }
  }

  for (const advisory of advisories.values()) {
    const affected = new Set(advisory.packages);
    const queue = [...affected];

    while (queue.length > 0) {
      for (const effect of vulnerabilities[queue.shift()]?.effects ?? []) {
        if (!affected.has(effect)) {
          affected.add(effect);
          queue.push(effect);
        }
      }
    }

    advisory.affected = [...affected].toSorted();
  }

  return advisories;
}

/**
 * Why an `npm audit --json` result is not a usable report, or undefined. The
 * gate fails closed: an error object, a missing count block, or a non-zero
 * exit with no finding counted is never read as "no advisory".
 */
export function auditReportProblem(report, exitStatus) {
  if (!report || typeof report !== 'object')
    return 'the output is not a JSON object';
  if (report.error)
    return `npm reported an error: ${report.message ?? JSON.stringify(report.error)}`;
  if (
    typeof report.vulnerabilities !== 'object' ||
    report.vulnerabilities === null
  ) {
    return 'the report has no "vulnerabilities" object';
  }

  const total = report.metadata?.vulnerabilities?.total;

  if (!Number.isInteger(total))
    return 'the report has no "metadata.vulnerabilities.total" count';
  if (exitStatus !== 0 && total === 0)
    return `npm exited ${exitStatus} with no advisory counted`;

  return undefined;
}

/**
 * Turns the output of `npm audit --json` into { report } or { problem }. Every
 * reader of that output goes through it, so none reads an unusable report as
 * "no advisory".
 */
export function readAuditReport({ stdout, status }) {
  let report;

  try {
    report = JSON.parse(stdout);
  } catch {
    report = undefined;
  }

  const problem = auditReportProblem(report, status);

  return problem === undefined ? { report } : { problem };
}

function fixIsAvailable(fixAvailable) {
  return (
    fixAvailable === true ||
    (typeof fixAvailable === 'object' &&
      fixAvailable !== null &&
      !fixAvailable.isSemVerMajor)
  );
}

/**
 * Decides the gate for one workspace. `lock` is its package-lock.json and
 * `latest` maps a package name to its `latest` dist-tag.
 * Returns { blocking, covered, unused }: the gate fails when `blocking` or
 * `unused` is not empty.
 */
export function judgeAudit(
  audit,
  { workspace, registry, lock, today, latest }
) {
  const vulnerabilities = audit?.vulnerabilities ?? {};
  const risks = registry.risks.filter((risk) =>
    risk.workspaces.includes(workspace)
  );
  const blocking = [];
  const covered = [];
  const used = new Set();

  for (const advisory of collectAdvisories(audit).values()) {
    if (!GATE_SEVERITIES.has(advisory.severity)) continue;

    const label = `${advisory.id} (${advisory.severity}, ${[...advisory.packages].join(', ')} ${advisory.range}) ${advisory.url}`;
    const risk = risks.find((candidate) => candidate.id === advisory.id);

    if (!risk) {
      blocking.push(`${label}\n    affects: ${advisory.affected.join(', ')}`);
      continue;
    }

    used.add(risk.id);

    const reasons = [];
    const expected = risk.affected.toSorted();

    if (expected.join('\n') !== advisory.affected.join('\n')) {
      reasons.push(
        `affected packages are [${advisory.affected.join(', ')}], the entry lists [${expected.join(', ')}]`
      );
    }

    if (risk.expires < today)
      reasons.push(`the entry expired on ${risk.expires}`);

    for (const name of advisory.packages) {
      const entry = vulnerabilities[name];

      for (const node of entry?.nodes ?? []) {
        const installed = lock?.packages?.[node]?.version;

        if (installed !== risk.version) {
          reasons.push(
            `${node} is ${installed ?? 'not in the lockfile'}, the entry lists ${risk.version}`
          );
        }
      }

      if (fixIsAvailable(entry?.fixAvailable)) {
        reasons.push(`npm reports a fix for ${name}: run npm audit fix`);
      }
    }

    const newest = latest[risk.package];

    if (newest && newest !== risk.version) {
      reasons.push(
        `${risk.package} ${newest} is released: update to it if it fixes ${advisory.id}, or re-check the entry`
      );
    }

    if (reasons.length > 0) {
      blocking.push(
        `${label}\n    accepted risk no longer applies:\n      - ${reasons.join('\n      - ')}`
      );
    } else {
      covered.push(
        `${label}\n    accepted until ${risk.expires}: ${risk.reachability}`
      );
    }
  }

  const unused = risks
    .filter((risk) => !used.has(risk.id))
    .map(
      (risk) =>
        `${risk.id} (${risk.package}) no longer blocks the ${workspace} gate: remove its entry from ${REGISTRY_FILE}, or remove "${workspace}" from its workspaces`
    );

  return { blocking, covered, unused };
}

function npmPurl(name, version) {
  const encoded = name.startsWith('@') ? `%40${name.slice(1)}` : name;

  return `pkg:npm/${encoded}@${version}`;
}

/** The content of .trivyignore.yaml. JSON strings are valid YAML scalars. */
export function trivyignoreYaml(registry) {
  const lines = [
    `# Generated from ${REGISTRY_FILE}. Do not edit: run`,
    '# `npm run check:accepted-risks -- --write` in server/.',
    'vulnerabilities:'
  ];

  for (const risk of registry.risks) {
    for (const id of [risk.id, ...risk.aliases]) {
      lines.push(
        `  - id: ${id}`,
        '    purls:',
        `      - ${JSON.stringify(npmPurl(risk.package, risk.version))}`,
        `    expired_at: ${risk.expires}`,
        `    statement: ${JSON.stringify(risk.reachability)}`
      );
    }
  }

  if (registry.risks.length === 0)
    lines[lines.length - 1] = 'vulnerabilities: []';

  return `${lines.join('\n')}\n`;
}

/** Entries that `next` adds or changes compared with `base`. */
export function changedRisks(base, next) {
  const before = new Map(
    base.risks.map((risk) => [risk.id, JSON.stringify(risk)])
  );

  return next.risks.filter(
    (risk) => before.get(risk.id) !== JSON.stringify(risk)
  );
}
