import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Request scenarios: one request, its actor and its expected result, written
 * once in `contracts/scenarios/` and run by the server e2e suite and by the
 * mock-server suite. Each runner builds the fixtures below its own way, so a
 * scenario states behaviour and never an implementation detail.
 */

/** The accounts a scenario can act as. Every runner builds each of them. */
export const ACTOR_FIXTURES = [
  /** The super role and a password. */
  'admin',
  /** The default `user` role, a password and a verified address. */
  'user',
  /** A password and a verified address, and no role. */
  'user-no-roles',
  /** As `user`, with an authenticator and the recovery code below. */
  'user-mfa',
  /** As `user`, with no password and a linked `google` account. */
  'oauth-only',
  /** As `user`, with an address that is not verified. */
  'unverified',
  /** As `user`, locked after too many failed sign-ins. */
  'locked'
] as const;
export type ActorFixture = (typeof ACTOR_FIXTURES)[number];

/** State that a runner builds for the actor before the request. */
export const STATE_FIXTURES = [
  /** The request carries the refresh cookie of the session of the bearer. */
  'refresh-cookie',
  /** A second session of the actor; `$otherSessionId` is its id. */
  'second-session',
  /** A mailed verification link; `$verificationToken`. */
  'verification-token',
  /** A mailed password reset link; `$resetToken`. */
  'reset-token',
  /** An email change to `$newEmail` that waits for `$emailChangeToken`. */
  'email-change-token',
  /** An authenticator setup that waits for `$setupCode`. */
  'mfa-setup',
  /** A correct password of `user-mfa`, which gives `$mfaToken`. */
  'mfa-challenge',
  /** The request carries the `oauth_data` cookie of a `google` sign-in. */
  'oauth-data',
  /** A linked `vk` account. */
  'vk-linked',
  /** Wrong step-up codes of `user-mfa`, one below the lock. */
  'step-up-code-failures'
] as const;
export type StateFixture = (typeof STATE_FIXTURES)[number];

/** A body string or a path segment that is exactly one of these is replaced. */
export const SCENARIO_PLACEHOLDERS = [
  '$email',
  '$password',
  '$newPassword',
  '$newEmail',
  '$code',
  '$recoveryCode',
  '$verificationToken',
  '$resetToken',
  '$emailChangeToken',
  '$setupCode',
  '$mfaToken',
  '$otherSessionId',
  '$targetId'
] as const;
export type ScenarioPlaceholder = (typeof SCENARIO_PLACEHOLDERS)[number];

/** Passwords that `localPasswordRefusal` accepts for every fixture name. */
export const SCENARIO_PASSWORD = 'Lantern-Orchard-47';
export const SCENARIO_NEW_PASSWORD = 'Copper-Meadow-83';
/** The unused recovery code of `user-mfa`. */
export const SCENARIO_RECOVERY_CODE = 'AAAAAAAA-AAAAAAAA-AAAAAAAA';

export interface RequestScenario {
  name: string;
  /** `METHOD /path`, exactly as one entry of `contracts/routes`. */
  route: string;
  /** The request path, when the path of the route entry holds a sample id. */
  path?: string;
  /** The account of the scenario. Absent when the request names none. */
  actor?: ActorFixture;
  /** `bearer` sends an access token of the actor. */
  auth: 'bearer' | 'none';
  state?: StateFixture[];
  /** A second account; `$targetId` is its id. */
  target?: ActorFixture;
  body?: Record<string, unknown>;
  /** Send the request this many times. The last answer must match `expect`. */
  repeat?: number;
  expect: ScenarioAnswer & {
    /** The answer of each request before the last. Default: `expect`. */
    earlier?: ScenarioAnswer;
    /**
     * The actions of the audit rows that all requests write and that name an
     * account of the scenario. The runners compare them in any order: the
     * server writes some rows fire-and-forget.
     */
    audit: string[];
  };
}

export interface ScenarioAnswer {
  status: number;
  errorKey: string | null;
}

/** The expected answer of each request of a scenario, in order. */
export function expectedAnswers(scenario: RequestScenario): ScenarioAnswer[] {
  const { status, errorKey, earlier } = scenario.expect;
  const count = scenario.repeat ?? 1;
  return Array.from({ length: count }, (_, i) =>
    i === count - 1 ? { status, errorKey } : (earlier ?? { status, errorKey })
  );
}

export interface ScenarioFile {
  /** The file name, the same as its file in `contracts/routes`. */
  file: string;
  scenarios: RequestScenario[];
}

const CONTRACTS_DIR = resolve(__dirname, '..', '..', '..', 'contracts');
export const SCENARIOS_DIR = join(CONTRACTS_DIR, 'scenarios');
export const ROUTES_DIR = join(CONTRACTS_DIR, 'routes');

const SCENARIO_KEYS = new Set([
  'name',
  'route',
  'path',
  'actor',
  'auth',
  'state',
  'target',
  'body',
  'repeat',
  'expect'
]);

function includes<T extends string>(list: readonly T[], value: unknown) {
  return (
    typeof value === 'string' && (list as readonly string[]).includes(value)
  );
}

function placeholdersIn(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.startsWith('$') ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap(placeholdersIn);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(placeholdersIn);
  }
  return [];
}

/** The problems of one scenario, as text. An empty list means it is valid. */
export function scenarioErrors(scenario: RequestScenario): string[] {
  const errors: string[] = [];
  for (const key of Object.keys(scenario)) {
    if (!SCENARIO_KEYS.has(key)) errors.push(`unknown key "${key}"`);
  }
  if (!/^(POST|PUT|PATCH|DELETE|GET) \/\S+$/.test(scenario.route ?? '')) {
    errors.push(`route "${scenario.route}" is not "METHOD /path"`);
  }
  if (scenario.auth !== 'bearer' && scenario.auth !== 'none') {
    errors.push('auth must be "bearer" or "none"');
  }
  if (scenario.auth === 'bearer' && !scenario.actor) {
    errors.push('auth "bearer" needs an actor');
  }
  for (const fixture of [scenario.actor, scenario.target]) {
    if (fixture !== undefined && !includes(ACTOR_FIXTURES, fixture)) {
      errors.push(`unknown actor fixture "${fixture}"`);
    }
  }
  for (const fixture of scenario.state ?? []) {
    if (!includes(STATE_FIXTURES, fixture)) {
      errors.push(`unknown state fixture "${fixture}"`);
    }
  }
  const segments = (scenario.path ?? '').split('/');
  for (const name of [
    ...placeholdersIn(scenario.body),
    ...placeholdersIn(segments)
  ]) {
    if (!includes(SCENARIO_PLACEHOLDERS, name)) {
      errors.push(`unknown placeholder "${name}"`);
    }
  }
  const { expect } = scenario;
  if (
    typeof expect?.status !== 'number' ||
    !(expect.errorKey === null || typeof expect.errorKey === 'string') ||
    !Array.isArray(expect.audit)
  ) {
    errors.push('expect needs status, errorKey (or null) and audit');
  }
  if (
    scenario.repeat !== undefined &&
    !(Number.isInteger(scenario.repeat) && scenario.repeat > 1)
  ) {
    errors.push('repeat must be an integer above 1');
  }
  if (expect?.earlier !== undefined && scenario.repeat === undefined) {
    errors.push('expect.earlier needs repeat');
  }
  return errors.map((e) => `${scenario.name}: ${e}`);
}

/** Every scenario file, validated. Throws on the first invalid scenario. */
export function loadScenarioFiles(): ScenarioFile[] {
  return readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const { scenarios } = JSON.parse(
        readFileSync(join(SCENARIOS_DIR, file), 'utf-8')
      ) as { scenarios: RequestScenario[] };
      const errors = scenarios.flatMap(scenarioErrors);
      if (errors.length > 0) {
        throw new Error(`${file}: ${errors.join('; ')}`);
      }
      return { file, scenarios };
    });
}

/** Replaces each placeholder in a body or a path with its value. */
export function resolvePlaceholders<T>(
  value: T,
  values: Partial<Record<ScenarioPlaceholder, string>>
): T {
  const resolveOne = (v: unknown): unknown => {
    if (typeof v === 'string' && includes(SCENARIO_PLACEHOLDERS, v)) {
      const resolved = values[v as ScenarioPlaceholder];
      if (resolved === undefined) {
        throw new Error(`no value for placeholder ${v}`);
      }
      return resolved;
    }
    if (Array.isArray(v)) return v.map(resolveOne);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v).map(([k, inner]) => [k, resolveOne(inner)])
      );
    }
    return v;
  };
  return resolveOne(value) as T;
}

/** The request path of a scenario, with its placeholders replaced. */
export function scenarioPath(
  scenario: RequestScenario,
  values: Partial<Record<ScenarioPlaceholder, string>>
): string {
  const path = scenario.path ?? scenario.route.split(' ')[1];
  return path
    .split('/')
    .map((segment) => resolvePlaceholders(segment, values))
    .join('/');
}

export function scenarioMethod(scenario: RequestScenario): string {
  return scenario.route.split(' ')[0];
}
