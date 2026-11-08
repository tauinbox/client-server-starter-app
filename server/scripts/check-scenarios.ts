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
 * Each route of SIGN_IN_ROUTES must have a scenario for each state of
 * ACCOUNT_STATES. A scenario on such a route with a status of 400 or more
 * states its audit rows as { action, reason, target }, and each reason must be
 * in SIGN_IN_REFUSAL_REASONS.
 *
 * Usage (from server/): npm run check:scenarios [-- --self-test | --base <ref>]
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { SIGN_IN_REFUSAL_REASONS } from '@app/shared/constants';
import {
  ACCOUNT_STATES,
  loadScenarioFiles,
  RequestScenario,
  ROUTES_DIR,
  ScenarioFile,
  SIGN_IN_ROUTES,
  StateFixture
} from '@app/shared/utils/request-scenarios';

const PENDING_ROUTES = new Set<string>();

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
    .toSorted()
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
  {
    pending,
    base,
    matrix
  }: {
    pending: ReadonlySet<string>;
    base?: ReadonlySet<string>;
    matrix: SignInMatrix;
  }
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

  errors.push(...signInMatrixErrors(scenarioFiles, matrix, allRoutes));

  return errors;
}

export interface SignInMatrix {
  routes: readonly string[];
  states: readonly StateFixture[];
  reasons: readonly string[];
}

/**
 * Each pair of a sign-in route and an account state has a scenario. A refused
 * sign-in states its audit rows with their reason and target, and each reason
 * is in the vocabulary.
 */
function signInMatrixErrors(
  scenarioFiles: ScenarioFile[],
  { routes, states, reasons }: SignInMatrix,
  allRoutes: ReadonlySet<string>
): string[] {
  const errors: string[] = [];
  const scenarios = scenarioFiles
    .flatMap((f) => f.scenarios)
    .filter((s) => routes.includes(s.route));

  for (const route of routes) {
    if (!allRoutes.has(route)) {
      errors.push(
        `SIGN_IN_ROUTES names ${route}, which contracts/routes does not hold`
      );
      continue;
    }

    for (const state of states) {
      const covered = scenarios.some(
        (s) => s.route === route && s.state?.includes(state)
      );

      if (!covered) {
        errors.push(`${route} has no scenario for the account state ${state}`);
      }
    }
  }

  for (const s of scenarios) {
    const { status, audit } = s.expect;

    if (status >= 400 && audit.some((entry) => typeof entry === 'string')) {
      errors.push(
        `"${s.name}" refuses a sign-in and states its audit rows as actions: give each row { action, reason, target }`
      );
    }

    for (const entry of audit) {
      if (
        typeof entry !== 'string' &&
        entry.reason !== null &&
        !reasons.includes(entry.reason)
      ) {
        errors.push(
          `"${s.name}" expects the reason ${entry.reason}, which SIGN_IN_REFUSAL_REASONS does not hold`
        );
      }
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
  const refusal = (
    name: string,
    audit: RequestScenario['expect']['audit']
  ): RequestScenario => ({
    ...scenario(name, 'POST /api/v1/things', 401),
    state: ['deactivated-actor'],
    expect: { status: 401, errorKey: null, audit }
  });
  const failure = 'USER_LOGIN_FAILURE';
  const scenarioFiles: ScenarioFile[] = [
    {
      file: 'things.json',
      scenarios: [
        // Passes: a covered route that is not listed.
        scenario('create', 'POST /api/v1/things', 201),
        // Rule 2: a listed route that has a scenario.
        scenario('update', 'PATCH /api/v1/things/1', 200),
        // Rule 4: a scenario that names an unknown route.
        scenario('unknown', 'POST /api/v1/things/2', 200),
        // Passes: a refused sign-in with a row of the vocabulary.
        refusal('refused', [
          { action: failure, reason: 'invalid_credentials', target: 'none' }
        ]),
        // Rule 7: a refused sign-in that states actions only.
        refusal('actions', [failure]),
        // Rule 8: a reason that is not in the vocabulary.
        refusal('made up', [
          { action: failure, reason: 'made_up', target: 'actor' }
        ])
      ]
    }
  ];
  const matrix: SignInMatrix = {
    routes: [
      'POST /api/v1/things',
      // Rule 9: a sign-in route that no route file holds.
      'POST /api/v1/things/9/login'
    ],
    // Rule 6: no scenario of the sign-in route has `locked-actor`.
    states: ['deactivated-actor', 'locked-actor'],
    reasons: ['invalid_credentials']
  };
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

  const problems = scenarioCoverageErrors(routeFiles, scenarioFiles, {
    pending,
    base,
    matrix
  });

  const expected = [
    // Rule 1: an unlisted route with no scenario.
    'DELETE /api/v1/things/1 has no scenario',
    'PATCH /api/v1/things/1 has a scenario: remove it',
    'PENDING_ROUTES names DELETE /api/v1/things/9',
    '"unknown" names POST /api/v1/things/2',
    'POST /api/v1/things/1/copy is not pending on the base branch',
    'POST /api/v1/things has no scenario for the account state locked-actor',
    '"actions" refuses a sign-in and states its audit rows as actions',
    '"made up" expects the reason made_up',
    'SIGN_IN_ROUTES names POST /api/v1/things/9/login'
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

  console.log('check-scenarios self-test: all nine rules report');
}

function main(): void {
  const i = process.argv.indexOf('--base');
  const ref = i === -1 ? undefined : process.argv[i + 1];

  if (i !== -1 && !ref) {
    console.error('--base needs a git ref, for example origin/master');
    process.exit(1);
  }

  const errors = scenarioCoverageErrors(loadRouteFiles(), loadScenarioFiles(), {
    pending: PENDING_ROUTES,
    base: ref ? routesWithoutScenarioAt(ref) : undefined,
    matrix: {
      routes: SIGN_IN_ROUTES,
      states: ACCOUNT_STATES,
      reasons: SIGN_IN_REFUSAL_REASONS
    }
  });

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
