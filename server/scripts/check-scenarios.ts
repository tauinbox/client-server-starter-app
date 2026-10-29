/**
 * Verifies that each state-changing route has a request scenario.
 *
 * A route file of contracts/routes is complete when each of its POST, PUT,
 * PATCH and DELETE routes has a scenario in the scenario file of the same
 * name whose status is below 400, or carries `noSuccessScenario: "<reason>"`.
 * Each scenario must name a route of its route file. The files in PENDING
 * are not checked yet; a PENDING file that is complete fails, so the list
 * can only get shorter.
 *
 * Usage (from server/): npm run check:scenarios
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadScenarioFiles,
  ROUTES_DIR,
  ScenarioFile
} from '@app/shared/utils/request-scenarios';

const PENDING = new Set([
  'billing-admin.json',
  'billing.json',
  'feature-flags.json',
  'rbac.json',
  'roles.json',
  'users.json'
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

/** The problems, as text. An empty list means the check passes. */
export function scenarioCoverageErrors(
  routeFiles: RouteFile[],
  scenarioFiles: ScenarioFile[],
  pending: ReadonlySet<string>
): string[] {
  const errors: string[] = [];
  const routesByFile = new Map(
    routeFiles.map((f) => [
      f.file,
      new Set(f.routes.map((r) => `${r.method} ${r.path}`))
    ])
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

  for (const name of pending) {
    if (!routesByFile.has(name)) {
      errors.push(
        `PENDING names ${name}, which contracts/routes does not hold`
      );
    }
  }

  for (const { file, routes } of routeFiles) {
    const succeeded = new Set(
      (scenarioFiles.find((f) => f.file === file)?.scenarios ?? [])
        .filter((s) => s.expect.status < 400)
        .map((s) => s.route)
    );
    const missing = routes
      .filter((r) => STATE_CHANGING.has(r.method))
      .filter((r) => r.noSuccessScenario === undefined)
      .map((r) => `${r.method} ${r.path}`)
      .filter((route) => !succeeded.has(route));

    if (pending.has(file)) {
      if (missing.length === 0) {
        errors.push(`${file} is complete: remove it from PENDING`);
      }
      continue;
    }
    for (const route of missing) {
      errors.push(
        `${route} (routes/${file}) has no scenario with a status below 400`
      );
    }
  }
  return errors;
}

function main(): void {
  const errors = scenarioCoverageErrors(
    loadRouteFiles(),
    loadScenarioFiles(),
    PENDING
  );
  if (errors.length > 0) {
    console.error('Request scenario coverage failed:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('Request scenario coverage OK');
}

if (require.main === module) {
  main();
}
