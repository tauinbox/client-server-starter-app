import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ERROR_STATUS, type ErrorKey } from '../constants/error-status';
import type { LegalDocumentVersion } from '../constants/legal.constants';
import { AuditAction } from '../enums/audit-action.enum';
import {
  type FieldChecks,
  httpStatus,
  includes,
  listOf,
  nullOr,
  objectOf,
  oneOf,
  optional,
  routeLine,
  text,
  type FieldCheck
} from './contract-schema';
import { CONTRACTS_DIR } from './route-contracts';

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
  'oauth-only'
] as const;
export type ActorFixture = (typeof ACTOR_FIXTURES)[number];

/** State that a runner builds for the actor before the request. */
export const STATE_FIXTURES = [
  /** The request carries the refresh cookie of the session of the bearer. */
  'refresh-cookie',
  /**
   * A second session of the actor; `$otherSessionId` is its id and
   * `$currentSessionId` is the id of the session of the bearer.
   */
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
  /**
   * The request carries the `oauth_signup` cookie of a `google` sign-in of an
   * identity that no account holds, with the address `$newEmail`.
   */
  'oauth-signup',
  /** A linked `vk` account. */
  'vk-linked',
  /** The actor has declared `DE` as its country of residence. */
  'residence-declared',
  /** Wrong step-up codes of `user-mfa`, one below the lock. */
  'step-up-code-failures',
  /** A role that is not a system role, named `$roleName`; `$roleId`. */
  'custom-role',
  /** The `custom-role` holds `$permissionId` with no conditions. */
  'role-permission',
  /** The target holds the `custom-role`. */
  'target-role',
  /**
   * A resource that a controller registers, with the actions `read` and
   * `update` and no admin narrowing; `$resourceId`.
   */
  'resource',
  /** The `resource` is orphaned. */
  'orphaned-resource',
  /** No controller registers the `resource`. */
  'unregistered-resource',
  /** The target is soft-deleted. */
  'deleted-target',
  /** A flag with the key `$flagKey`, at version 1, with no rules; `$flagId`. */
  'feature-flag',
  /** A `yookassa` billing customer of the actor in `RU`; `$customerId`. */
  'customer',
  /**
   * A billing customer of the actor, `$customerId`, with an active
   * subscription that the server renews, `$subscriptionId`. Its period
   * started one day ago, and its plan key is `$fixedPlanKey`. It uses the
   * `customer` when the scenario has one.
   */
  'subscription',
  /** A default saved `yookassa` card of the `customer`. */
  'saved-card',
  /**
   * A fixed monthly plan `$fixedPlanKey` with a `yookassa` price of 10.00
   * RUB.
   */
  'fixed-plan',
  /** A fixed monthly plan `$planKey` with a `yookassa` price of 10.00 RUB. */
  'other-plan',
  /** A product `$productKey` with a `yookassa` price of 5.00 RUB. */
  'product',
  /** The kill switches of all billing providers are off for the actor. */
  'providers-disabled',
  /**
   * The terms of every jurisdiction are published at the version of
   * `PUBLISHED_SCENARIO_TERMS`, so a checkout and a purchase must accept it.
   */
  'published-terms',
  /** A paid invoice of 1000 minor units of the `subscription`; `$invoiceId`. */
  'paid-invoice',
  /**
   * A fixed monthly plan `$fixedPlanKey` with the capability `api-access`,
   * which the `api_calls` meter measures.
   */
  'api-access-plan',
  /** A credit balance of 10 units of the `customer`. */
  'credits',
  /**
   * A usage record of 5 units under `api_calls` of the `customer`, paid from
   * credits, with the idempotency key `scenario-usage`.
   */
  'usage-record',
  /** A webhook event in `dead_letter`; `$webhookEventId`. */
  'dead-letter-webhook-event',
  /** An unread `invoice_paid` notice of the actor; `$notificationId`. */
  'notification',
  /*
   * The account states below change the actor after the fixtures before them
   * in `state`. Put them after the fixtures that sign the actor in, for
   * example `refresh-cookie`, `oauth-data` and `mfa-challenge`.
   */
  /** The actor is deactivated. */
  'deactivated-actor',
  /** The actor is soft-deleted, and its sessions are not yet revoked. */
  'deleted-actor',
  /**
   * Every session of the actor is revoked, as a sign-out everywhere does,
   * 100 ms after the fixtures before it on a frozen clock (`scenarioClock`).
   */
  'revoked-actor',
  /** The actor is locked after too many failed sign-ins. */
  'locked-actor',
  /** The address of the actor is not verified. */
  'unverified-actor',
  /** The actor has no password. */
  'passwordless-actor'
] as const;
export type StateFixture = (typeof STATE_FIXTURES)[number];

/** The routes that sign an account in or keep its session. */
export const SIGN_IN_ROUTES = [
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh-token',
  'POST /api/v1/auth/oauth/exchange',
  'POST /api/v1/auth/mfa/verify',
  'POST /api/v1/auth/mfa/recovery'
] as const;

/**
 * The account states that each route of `SIGN_IN_ROUTES` runs against: each
 * pair of a route and a state has a scenario.
 */
export const ACCOUNT_STATES = [
  'deactivated-actor',
  'deleted-actor',
  'revoked-actor',
  'locked-actor',
  'unverified-actor',
  'passwordless-actor'
] as const satisfies readonly StateFixture[];
export type AccountState = (typeof ACCOUNT_STATES)[number];

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
  '$currentSessionId',
  '$actorId',
  '$targetId',
  /** A role name that no role has before the request. */
  '$roleName',
  '$roleId',
  /** The id of the `read:Role` permission. */
  '$permissionId',
  '$resourceId',
  /** A flag key that no flag has before the request. */
  '$flagKey',
  '$flagId',
  '$customerId',
  '$subscriptionId',
  '$invoiceId',
  /** A meter key that is not in the meter catalog (`METERS`). */
  '$meterKey',
  '$webhookEventId',
  '$notificationId',
  /**
   * The key of the plan of the `fixed-plan`, `subscription` and
   * `api-access-plan` states. No plan has it before the request.
   */
  '$fixedPlanKey',
  /** A plan key that no plan has before the request. */
  '$planKey',
  /** A product key that no product has before the request. */
  '$productKey'
] as const;
export type ScenarioPlaceholder = (typeof SCENARIO_PLACEHOLDERS)[number];

/** The values of `auth`. `bearer` sends an access token of the actor. */
export const SCENARIO_AUTH = ['bearer', 'none'] as const;

/** The targets of an audit row. `actor`: the row names the actor. */
export const AUDIT_ROW_TARGETS = ['actor', 'none'] as const;

/** Passwords that `localPasswordRefusal` accepts for every fixture name. */
export const SCENARIO_PASSWORD = 'Lantern-Orchard-47';
export const SCENARIO_NEW_PASSWORD = 'Copper-Meadow-83';
/** The unused recovery code of `user-mfa`. */
export const SCENARIO_RECOVERY_CODE = 'AAAAAAAA-AAAAAAAA-AAAAAAAA';
/** The terms of every jurisdiction under the `published-terms` state. */
export const PUBLISHED_SCENARIO_TERMS: LegalDocumentVersion = {
  version: '2030-01-01',
  status: 'published'
};

export interface RequestScenario {
  name: string;
  /** `METHOD /path`, exactly as one entry of `contracts/routes`. */
  route: string;
  /** The request path, when the path of the route entry holds a sample id. */
  path?: string;
  /** The account of the scenario. Absent when the request names none. */
  actor?: ActorFixture;
  auth: (typeof SCENARIO_AUTH)[number];
  state?: StateFixture[];
  /** A second account; `$targetId` is its id. */
  target?: ActorFixture;
  /** Request headers, for example `If-Match`. */
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  /** Send the request this many times. The last answer must match `expect`. */
  repeat?: number;
  expect: ScenarioAnswer & {
    /** The answer of each request before the last. Default: `expect`. */
    earlier?: ScenarioAnswer;
    /**
     * The audit rows that all requests write and that name an account of the
     * scenario, as actions or as rows. The runners compare them in any order:
     * the server writes some rows fire-and-forget. All entries of one
     * scenario have the same form.
     */
    audit: AuditAction[] | ScenarioAuditRow[];
  };
}

/** An audit row: its action, its `details.reason` and its target. */
export interface ScenarioAuditRow {
  action: AuditAction;
  reason: string | null;
  target: (typeof AUDIT_ROW_TARGETS)[number];
}

/** An audit row as a runner reads it. */
export interface WrittenAuditRow {
  action: string;
  targetId: string | null;
  details: Record<string, unknown> | null;
}

function auditRowKey(row: {
  action: string;
  reason: string | null;
  target: string;
}): string {
  return `${row.action} reason=${row.reason ?? '-'} target=${row.target}`;
}

function isAuditRowList(
  audit: RequestScenario['expect']['audit']
): audit is ScenarioAuditRow[] {
  return audit.some((entry) => typeof entry !== 'string');
}

/** The expected audit rows of a scenario, in a stable order. */
export function expectedAuditRows(scenario: RequestScenario): string[] {
  const { audit } = scenario.expect;

  return isAuditRowList(audit)
    ? audit.map(auditRowKey).toSorted()
    : audit.toSorted();
}

/**
 * The written audit rows in the form of the expected rows of the scenario,
 * in a stable order. `actorId` is the id of the actor of the scenario.
 */
export function writtenAuditRows(
  scenario: RequestScenario,
  { rows, actorId }: { rows: WrittenAuditRow[]; actorId: string | undefined }
): string[] {
  if (!isAuditRowList(scenario.expect.audit)) {
    return rows.map((row) => row.action).toSorted();
  }

  return rows
    .map((row) => {
      const reason = row.details?.['reason'];

      return auditRowKey({
        action: row.action,
        reason: typeof reason === 'string' ? reason : null,
        target:
          actorId !== undefined && row.targetId === actorId ? 'actor' : 'none'
      });
    })
    .toSorted();
}

export interface ScenarioAnswer {
  status: number;
  /** The status must be the status of the key in `ERROR_STATUS`. */
  errorKey: ErrorKey | null;
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

export const SCENARIOS_DIR = join(CONTRACTS_DIR, 'scenarios');

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

/*
 * The schema of a scenario, built with the checks of `contract-schema.ts`:
 * one check for each field of each scenario type.
 */

const ERROR_KEYS = Object.keys(ERROR_STATUS);
const AUDIT_ACTIONS = Object.values(AuditAction);

const repeatCount: FieldCheck = (value) =>
  Number.isInteger(value) && Number(value) > 1
    ? []
    : ['is not an integer above 1'];

const placeholder = oneOf('placeholder', SCENARIO_PLACEHOLDERS);

const placeholders: FieldCheck = (value) =>
  placeholdersIn(value).flatMap(placeholder);

const pathPlaceholders: FieldCheck = (value) =>
  typeof value === 'string'
    ? placeholders(value.split('/'))
    : ['is not a string'];

const actorFixture = oneOf('actor fixture', ACTOR_FIXTURES);
const auditAction = oneOf('audit action', AUDIT_ACTIONS);
const errorKey = nullOr(oneOf('error key', ERROR_KEYS));

const AUDIT_ROW_FIELDS: FieldChecks<ScenarioAuditRow> = {
  action: auditAction,
  // Free text here: `check:scenarios` checks the reason of a refused sign-in
  // against SIGN_IN_REFUSAL_REASONS, because the list depends on the route.
  reason: nullOr(text),
  target: oneOf('audit target', AUDIT_ROW_TARGETS)
};

const auditRow = objectOf(AUDIT_ROW_FIELDS);

const auditList: FieldCheck = (value) => {
  if (!Array.isArray(value)) return ['is not a list'];

  if (value.every((entry) => typeof entry === 'string')) {
    return value.flatMap(auditAction);
  }

  return value.some((entry) => typeof entry === 'string')
    ? ['holds actions only, or rows of { action, reason, target } only']
    : value.flatMap(auditRow);
};

const ANSWER_FIELDS: FieldChecks<ScenarioAnswer> = {
  status: httpStatus,
  errorKey
};

const EXPECT_FIELDS: FieldChecks<RequestScenario['expect']> = {
  ...ANSWER_FIELDS,
  earlier: optional(objectOf(ANSWER_FIELDS)),
  audit: auditList
};

const SCENARIO_FIELDS: FieldChecks<RequestScenario> = {
  name: text,
  route: routeLine,
  path: optional(pathPlaceholders),
  actor: optional(actorFixture),
  auth: oneOf('auth', SCENARIO_AUTH),
  state: optional(listOf(oneOf('state fixture', STATE_FIXTURES))),
  target: optional(actorFixture),
  headers: optional(placeholders),
  body: optional(placeholders),
  repeat: optional(repeatCount),
  expect: objectOf(EXPECT_FIELDS)
};

/** An answer with an error key has the status of that key. */
function answerStatusErrors(answer: unknown, field: string): string[] {
  if (answer === null || typeof answer !== 'object') return [];

  const { status, errorKey: key } = answer as Partial<ScenarioAnswer>;

  if (!key || !includes(ERROR_KEYS, key) || ERROR_STATUS[key] === status) {
    return [];
  }

  return [
    `${field}: the status of error key "${key}" is ${ERROR_STATUS[key]} in ERROR_STATUS, not ${status}`
  ];
}

/** The problems of one scenario, as text. An empty list means it is valid. */
export function scenarioErrors(scenario: RequestScenario): string[] {
  const errors = objectOf(SCENARIO_FIELDS)(scenario);
  const { expect } = scenario;

  if (scenario.auth === 'bearer' && !scenario.actor) {
    errors.push('auth "bearer" needs an actor');
  }

  if (expect?.earlier !== undefined && scenario.repeat === undefined) {
    errors.push('expect.earlier needs repeat');
  }

  errors.push(
    ...answerStatusErrors(expect, 'expect'),
    ...answerStatusErrors(expect?.earlier, 'expect.earlier')
  );

  return errors.map((e) => `${scenario.name}: ${e}`);
}

/** Every scenario file, validated. Throws on the first invalid scenario. */
export function loadScenarioFiles(): ScenarioFile[] {
  return readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith('.json'))
    .toSorted()
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

/** The calls of the Jest object that the scenario clock makes. */
export interface ScenarioClockDriver {
  useFakeTimers(config: {
    now: number;
    doNotFake: (
      | 'hrtime'
      | 'nextTick'
      | 'performance'
      | 'queueMicrotask'
      | 'setImmediate'
      | 'clearImmediate'
      | 'setInterval'
      | 'clearInterval'
      | 'setTimeout'
      | 'clearTimeout'
    )[];
  }): unknown;
  setSystemTime(now: number): void;
  useRealTimers(): unknown;
}

/**
 * A clock for the tests of a revocation (the `revoked-actor` fixture and the
 * revocation e2e and parity specs), so that the order of a token or a session
 * and a revocation does not depend on the speed of the machine.
 * `freeze` stops `Date` at 100 ms into the previous second; the timers stay
 * real. Tokens issued then and a revocation after `advance` share one second
 * in a fixed order, and the real time after `release` is later than both.
 */
export function scenarioClock(driver: ScenarioClockDriver) {
  let frozen = false;

  return {
    freeze(): void {
      const second = Math.floor(Date.now() / 1000) * 1000;

      driver.useFakeTimers({
        now: second - 900,
        doNotFake: [
          'hrtime',
          'nextTick',
          'performance',
          'queueMicrotask',
          'setImmediate',
          'clearImmediate',
          'setInterval',
          'clearInterval',
          'setTimeout',
          'clearTimeout'
        ]
      });
      frozen = true;
    },
    advance(ms: number): void {
      if (!frozen) {
        throw new Error('freeze() must run before advance()');
      }

      driver.setSystemTime(Date.now() + ms);
    },
    release(): void {
      if (frozen) {
        driver.useRealTimers();
        frozen = false;
      }
    }
  };
}

export function scenarioMethod(scenario: RequestScenario): string {
  return scenario.route.split(' ')[0];
}
