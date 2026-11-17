import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  type FieldChecks,
  flag,
  HTTP_METHODS,
  type HttpMethod,
  httpStatus,
  listOf,
  matches,
  nullOr,
  objectOf,
  oneOf,
  optional,
  text,
  type FieldCheck
} from './contract-schema';

/**
 * The route contract: `contracts/routes/<feature>.json` holds one entry for
 * each route of the API. This module is the one loader of those files; each
 * check and test that reads them uses it, so each reader gets the same
 * validated entries.
 */

export const CONTRACTS_DIR = resolve(__dirname, '..', '..', '..', 'contracts');
export const ROUTES_DIR = join(CONTRACTS_DIR, 'routes');

/** The `access` values that name no permission. */
export const ROUTE_ACCESS_KEYWORDS = [
  'public',
  'signed-in',
  'optional'
] as const;

export type RouteThrottle = string[] | 'skip' | null;

export interface RoutePolicy {
  /** A keyword, or the permissions that `@Authorize` checks, joined by ` & `. */
  access: string;
  /** The permission that the route writes; `access` of some route names it. */
  writes: string | null;
  stepUp: boolean;
  countFailuresOnlyWhenBody: boolean;
  skipMfaEnrolmentGate: boolean;
  /** The throttler names, `skip`, or `null` for the global throttler only. */
  throttle: RouteThrottle;
  /** Why the route may have another `access` than the routes of its `writes`. */
  accessExempt?: string;
}

export interface RouteContract {
  method: HttpMethod;
  /** The path, with a sample value for each route parameter. */
  path: string;
  /** The status of a request with no credentials. */
  expectedStatus: number;
  policy: RoutePolicy;
  /** Why the route has no request scenario that succeeds. */
  noSuccessScenario?: string;
}

export interface RouteContractFile {
  /** The file name in `contracts/routes`. */
  file: string;
  routes: RouteContract[];
}

/** A route entry with the path of its file. */
export type LoadedRoute = RouteContract & { file: string };

const PERMISSION = /^[a-z]+:[A-Z][A-Za-z]*$/;

const permission = matches('a permission "action:Subject"', PERMISSION);

const access: FieldCheck = (value) => {
  if ((ROUTE_ACCESS_KEYWORDS as readonly unknown[]).includes(value)) return [];

  return typeof value === 'string' &&
    value.split(' & ').every((part) => PERMISSION.test(part))
    ? []
    : [
        `${JSON.stringify(value)} is not one of ${ROUTE_ACCESS_KEYWORDS.join(', ')} or permissions joined by " & "`
      ];
};

// The names are free text here: `check:route-policy` compares the whole
// policy, the throttler names included, with the decorators of the handler.
const throttle: FieldCheck = (value) =>
  value === null || value === 'skip' ? [] : listOf(text)(value);

const POLICY_FIELDS: FieldChecks<RoutePolicy> = {
  access,
  writes: nullOr(permission),
  stepUp: flag,
  countFailuresOnlyWhenBody: flag,
  skipMfaEnrolmentGate: flag,
  throttle,
  accessExempt: optional(text)
};

const ROUTE_FIELDS: FieldChecks<RouteContract> = {
  method: oneOf('method', HTTP_METHODS),
  path: matches('an API path', /^\/api\/\S+$/),
  expectedStatus: httpStatus,
  policy: objectOf(POLICY_FIELDS),
  noSuccessScenario: optional(text)
};

const FILE_FIELDS: FieldChecks<Omit<RouteContractFile, 'file'>> = {
  routes: listOf(() => [])
};

function routeName(entry: unknown, index: number): string {
  const { method, path } = (entry ?? {}) as Partial<RouteContract>;

  return method && path ? `${method} ${path}` : `route ${index}`;
}

/**
 * The problems of the route files, as text. Besides the schema of each entry:
 * a route is in one entry only, and `writes` names a permission that the
 * `access` of some route checks.
 */
export function routeContractErrors(
  files: { file: string; data: unknown }[]
): string[] {
  const errors: string[] = [];
  const seen = new Map<string, string>();
  const valid: LoadedRoute[] = [];

  for (const { file, data } of files) {
    errors.push(
      ...objectOf(FILE_FIELDS)(data).map((problem) => `${file}: ${problem}`)
    );

    const { routes } = (data ?? {}) as { routes?: unknown };

    if (!Array.isArray(routes)) continue;

    routes.forEach((entry: unknown, index) => {
      const name = routeName(entry, index);
      const problems = objectOf(ROUTE_FIELDS)(entry);

      errors.push(...problems.map((problem) => `${file}: ${name}: ${problem}`));

      if (problems.length > 0) return;

      const route = entry as RouteContract;
      const earlier = seen.get(name);

      if (earlier) {
        errors.push(`${file}: ${name}: the route is also in ${earlier}`);
      } else {
        seen.set(name, file);
        valid.push({ ...route, file });
      }
    });
  }

  const checked = new Set(
    valid.flatMap(({ policy }) => policy.access.split(' & '))
  );

  for (const { file, method, path, policy } of valid) {
    if (policy.writes !== null && !checked.has(policy.writes)) {
      errors.push(
        `${file}: ${method} ${path}: policy: writes: no route checks the permission "${policy.writes}" in its access`
      );
    }
  }

  return errors;
}

/** Every route file, validated. Throws with every problem. */
export function loadRouteContractFiles(): RouteContractFile[] {
  const files = readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.json'))
    .toSorted()
    .map((file) => ({
      file,
      data: JSON.parse(readFileSync(join(ROUTES_DIR, file), 'utf-8')) as unknown
    }));
  const errors = routeContractErrors(files);

  if (errors.length > 0) {
    throw new Error(`contracts/routes: ${errors.join('; ')}`);
  }

  return files.map(({ file, data }) => ({
    file,
    routes: (data as { routes: RouteContract[] }).routes
  }));
}

/** Every route entry of every route file, validated, with its file. */
export function loadRouteContracts(): LoadedRoute[] {
  return loadRouteContractFiles().flatMap(({ file, routes }) =>
    routes.map((route) => ({ ...route, file: `contracts/routes/${file}` }))
  );
}
