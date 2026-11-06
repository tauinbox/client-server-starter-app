/**
 * Cross-workspace version check. Zero dependencies: it reads only the
 * package.json and package-lock.json files of the three workspaces.
 *
 * A package that two or more workspaces declare must have:
 *   1. the same range in each package.json, and
 *   2. the same locked version in each package-lock.json.
 *
 * The `shared/` sources compile in each workspace, so a different TypeScript,
 * @types/node or ESLint version gives a different result in each workspace.
 * A transitive copy is not a declaration: a workspace that uses a package
 * declares it, so that this check can see it.
 *
 * `--self-test` runs the detector against synthetic workspaces and fails if
 * it stays silent.
 *
 * Exit code 1 if a package differs.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACES = ['client', 'server', 'mock-server'];
const SECTIONS = ['dependencies', 'devDependencies'];

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function loadWorkspace(name) {
  const dir = join(ROOT, name);

  return {
    name,
    pkg: readJson(join(dir, 'package.json')),
    lock: readJson(join(dir, 'package-lock.json'))
  };
}

function findDrift(workspaces) {
  const declared = new Map();

  for (const { name, pkg, lock } of workspaces) {
    for (const section of SECTIONS) {
      for (const [dep, range] of Object.entries(pkg[section] ?? {})) {
        const locked = lock.packages?.[`node_modules/${dep}`]?.version;
        const entries = declared.get(dep) ?? [];

        entries.push({ workspace: name, range, locked });
        declared.set(dep, entries);
      }
    }
  }

  const drift = [];

  for (const [dep, entries] of declared) {
    if (entries.length < 2) continue;

    const ranges = new Set(entries.map(({ range }) => range));
    const locked = new Set(entries.map((entry) => entry.locked));

    if (ranges.size > 1 || locked.size > 1) drift.push({ dep, entries });
  }

  return drift;
}

function report(drift) {
  if (drift.length === 0) {
    console.log('check-workspace-versions: OK');

    return false;
  }

  console.error(
    'ERROR: these packages have a different range or locked version in two workspaces.\n' +
      'Install the same range in each workspace with npm install.\n'
  );

  for (const { dep, entries } of drift) {
    const detail = entries
      .map(
        ({ workspace, range, locked }) =>
          `${workspace}=${range} (locked ${locked ?? 'none'})`
      )
      .join(', ');

    console.error(`  ${dep}: ${detail}`);
  }

  return true;
}

function fixture(name, deps) {
  const pkg = { devDependencies: {} };
  const lock = { packages: {} };

  for (const [dep, [range, locked]] of Object.entries(deps)) {
    pkg.devDependencies[dep] = range;
    lock.packages[`node_modules/${dep}`] = { version: locked };
  }

  return { name, pkg, lock };
}

function selfTest() {
  const cases = [
    {
      label: 'a different range',
      workspaces: [
        fixture('a', { x: ['~1.0.0', '1.0.0'] }),
        fixture('b', { x: ['^1.0.0', '1.0.0'] })
      ],
      expected: ['x']
    },
    {
      label: 'a different locked version',
      workspaces: [
        fixture('a', { x: ['^1.0.0', '1.0.0'] }),
        fixture('b', { x: ['^1.0.0', '1.2.0'] })
      ],
      expected: ['x']
    },
    {
      label: 'equal packages and a package of one workspace',
      workspaces: [
        fixture('a', { x: ['^1.0.0', '1.0.0'], y: ['^2.0.0', '2.0.0'] }),
        fixture('b', { x: ['^1.0.0', '1.0.0'] })
      ],
      expected: []
    }
  ];
  const failed = cases.filter(({ workspaces, expected }) => {
    const found = findDrift(workspaces).map(({ dep }) => dep);

    return found.join(',') !== expected.join(',');
  });

  if (failed.length > 0) {
    console.error(
      'ERROR: check-workspace-versions self-test failed for:\n' +
        failed.map(({ label }) => `  - ${label}`).join('\n')
    );
    process.exit(1);
  }

  console.log('check-workspace-versions: self-test OK');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else if (report(findDrift(WORKSPACES.map(loadWorkspace)))) {
  process.exit(1);
}
