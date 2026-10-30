/**
 * Verifies that each state-changing route has a request scenario.
 *
 * Each POST, PUT, PATCH and DELETE route of contracts/routes must have a
 * scenario in the scenario file of the same name whose status is below 400,
 * or carry `noSuccessScenario: "<reason>"`. Each scenario must name a route of
 * its route file. The routes in PENDING_ROUTES have no scenario yet. A listed
 * route that has a scenario, or that no route file holds, fails the check, and
 * so does a new route that is not listed. With `--base <ref>`, a listed route
 * also fails when it has a scenario or does not exist in that commit, so the
 * list can only get shorter.
 *
 * Usage (from server/): npm run check:scenarios [-- --self-test | --base <ref>]
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadScenarioFiles,
  RequestScenario,
  ROUTES_DIR,
  ScenarioFile
} from '@app/shared/utils/request-scenarios';

const PENDING_ROUTES = new Set([
  'POST /api/v1/billing/payment-method',
  'POST /api/v1/billing/purchase',
  'POST /api/v1/billing/checkout',
  'POST /api/v1/billing/subscription/change',
  'POST /api/v1/billing/subscription/change/preview',
  'POST /api/v1/billing/subscription/cancel',
  'PUT /api/v1/billing/region',
  'POST /api/v1/billing/webhooks/paddle',
  'POST /api/v1/billing/webhooks/yookassa'
]);

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface RouteEntry {
  method: string;
  path: string;
  noSuccessScenario?: string;
}

export interface RouteFile {
  file: string;
  routes: RouteEntry[];
}

function loadRouteFiles(): RouteFile[] {
  return fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({
      file,
      routes: (
        JSON.parse(fs.readFileSync(path.join(ROUTES_DIR, file), 'utf-8')) as {
          routes: RouteEntry[];
        }
      ).routes
    }));
}

/** The state-changing routes that have no scenario with a status below 400. */
function routesWithoutScenario(
  routeFiles: RouteFile[],
  scenarioFiles: ScenarioFile[]
): Set<string> {
  return new Set(
    routeFiles.flatMap(({ file, routes }) => {
      const succeeded = new Set(
        (scenarioFiles.find((f) => f.file === file)?.scenarios ?? [])
          .filter((s) => s.expect.status < 400)
          .map((s) => s.route)
      );
      return routes
        .filter((r) => STATE_CHANGING.has(r.method))
        .filter((r) => r.noSuccessScenario === undefined)
        .map((r) => `${r.method} ${r.path}`)
        .filter((route) => !succeeded.has(route));
    })
  );
}

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: path.resolve(ROUTES_DIR, '..', '..'),
    encoding: 'utf-8'
  });
}

function readJsonFilesAt<T>(ref: string, dir: string): [string, T][] {
  return git(['ls-tree', '--name-only', `${ref}:${dir}`])
    .split('\n')
    .filter((f) => f.endsWith('.json'))
    .map((file): [string, T] => [
      file,
      JSON.parse(git(['show', `${ref}:${dir}/${file}`])) as T
    ]);
}

/** The routes with no success scenario in the commit `ref`. */
function routesWithoutScenarioAt(ref: string): Set<string> {
  const routeFiles = readJsonFilesAt<{ routes: RouteEntry[] }>(
    ref,
    'contracts/routes'
  ).map(([file, { routes }]) => ({ file, routes }));
  const scenarioFiles = readJsonFilesAt<{ scenarios: RequestScenario[] }>(
    ref,
    'contracts/scenarios'
  ).map(([file, { scenarios }]) => ({ file, scenarios }));
  return routesWithoutScenario(routeFiles, scenarioFiles);
}

/**
 * The problems, as text. An empty list means the check passes.
 * `base` holds the routes with no success scenario on the base branch; a
 * listed route that is not in it was added to the list by this change.
 */
export function scenarioCoverageErrors(
  routeFiles: RouteFile[],
  scenarioFiles: ScenarioFile[],
  pending: ReadonlySet<string>,
  base?: ReadonlySet<string>
): string[] {
  const errors: string[] = [];
  const routesByFile = new Map(
    routeFiles.map((f) => [
      f.file,
      new Set(f.routes.map((r) => `${r.method} ${r.path}`))
    ])
  );
  const allRoutes = new Set(
    [...routesByFile.values()].flatMap((routes) => [...routes])
  );

  for (const { file, scenarios } of scenarioFiles) {
    const routes = routesByFile.get(file);
    if (!routes) {
      errors.push(`scenarios/${file} has no routes/${file}`);
      continue;
    }
    for (const s of scenarios) {
      if (!routes.has(s.route)) {
        errors.push(
          `scenarios/${file}: "${s.name}" names ${s.route}, which routes/${file} does not hold`
        );
      }
    }
  }

  const missing = routesWithoutScenario(routeFiles, scenarioFiles);
  for (const route of pending) {
    if (!allRoutes.has(route)) {
      errors.push(
        `PENDING_ROUTES names ${route}, which contracts/routes does not hold`
      );
    } else if (!missing.has(route)) {
      errors.push(`${route} has a scenario: remove it from PENDING_ROUTES`);
    } else if (base && !base.has(route)) {
      errors.push(
        `${route} is not pending on the base branch: add a scenario, not a PENDING_ROUTES entry`
      );
    }
  }
  for (const route of missing) {
    if (!pending.has(route)) {
      errors.push(`${route} has no scenario with a status below 400`);
    }
  }
  return errors;
}

function selfTest(): void {
  const routeFiles: RouteFile[] = [
    {
      file: 'things.json',
      routes: [
        { method: 'GET', path: '/api/v1/things' },
        { method: 'POST', path: '/api/v1/things' },
        { method: 'PATCH', path: '/api/v1/things/1' },
        { method: 'DELETE', path: '/api/v1/things/1' },
        { method: 'PUT', path: '/api/v1/things/1/owner' },
        { method: 'POST', path: '/api/v1/things/1/copy' },
        {
          method: 'POST',
          path: '/api/v1/things/1/archive',
          noSuccessScenario: 'fixture'
        }
      ]
    }
  ];
  const scenario = (
    name: string,
    route: string,
    status: number
  ): RequestScenario => ({
    name,
    route,
    auth: 'none',
    expect: { status, errorKey: null, audit: [] }
  });
  const scenarioFiles: ScenarioFile[] = [
    {
      file: 'things.json',
      scenarios: [
        // Passes: a covered route that is not listed.
        scenario('create', 'POST /api/v1/things', 201),
        // Rule 2: a listed route that has a scenario.
        scenario('update', 'PATCH /api/v1/things/1', 200),
        // Rule 4: a scenario that names an unknown route.
        scenario('unknown', 'POST /api/v1/things/2', 200)
      ]
    }
  ];
  const pending = new Set([
    'PATCH /api/v1/things/1',
    // Passes: a listed route with no scenario.
    'PUT /api/v1/things/1/owner',
    // Rule 3: a listed route that no route file holds.
    'DELETE /api/v1/things/9',
    // Rule 5: a listed route that the base branch does not list.
    'POST /api/v1/things/1/copy'
  ]);
  const base = new Set([
    'PATCH /api/v1/things/1',
    'PUT /api/v1/things/1/owner'
  ]);

  const problems = scenarioCoverageErrors(
    routeFiles,
    scenarioFiles,
    pending,
    base
  );

  const expected = [
    // Rule 1: an unlisted route with no scenario.
    'DELETE /api/v1/things/1 has no scenario',
    'PATCH /api/v1/things/1 has a scenario: remove it',
    'PENDING_ROUTES names DELETE /api/v1/things/9',
    '"unknown" names POST /api/v1/things/2',
    'POST /api/v1/things/1/copy is not pending on the base branch'
  ];
  const missing = expected.filter(
    (text) => !problems.some((p) => p.includes(text))
  );
  if (missing.length > 0 || problems.length !== expected.length) {
    console.error('check-scenarios self-test failed. Reported:');
    problems.forEach((p) => console.error(`    ${p}`));
    missing.forEach((text) => console.error(`  not reported: ${text}`));
    process.exit(1);
  }
  console.log('check-scenarios self-test: all five rules report');
}

function main(): void {
  const i = process.argv.indexOf('--base');
  const ref = i === -1 ? undefined : process.argv[i + 1];
  if (i !== -1 && !ref) {
    console.error('--base needs a git ref, for example origin/master');
    process.exit(1);
  }
  const errors = scenarioCoverageErrors(
    loadRouteFiles(),
    loadScenarioFiles(),
    PENDING_ROUTES,
    ref ? routesWithoutScenarioAt(ref) : undefined
  );
  if (errors.length > 0) {
    console.error('Request scenario coverage failed:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('Request scenario coverage OK');
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) selfTest();
  else main();
}
