/**
 * Verifies that the status of each error key in ERROR_STATUS agrees with the
 * name of the key. A name that follows a pattern below must have a status of
 * that pattern. A name that follows no pattern must be in UNPATTERNED with the
 * reason for its status. Exits with code 1 on any failure.
 *
 * Usage (from server/): npm run check:error-status
 *        npm run check:error-status -- --self-test
 */

import { ERROR_STATUS, ErrorKeys } from '@app/shared/constants';

interface Rule {
  pattern: RegExp;
  statuses: readonly number[];
  meaning: string;
}

const RULES: readonly Rule[] = [
  { pattern: /_EXISTS$/, statuses: [409], meaning: 'a taken value' },
  {
    pattern: /(^|_)ALREADY_/,
    statuses: [409],
    meaning: 'already in that state'
  },
  { pattern: /^SAME_/, statuses: [409], meaning: 'already in that state' },
  {
    pattern: /^NOT_(DELETED|ORPHANED)$/,
    statuses: [409],
    meaning: 'not in the state to restore'
  },
  { pattern: /_CONFLICT$/, statuses: [409], meaning: 'a concurrent change' },
  {
    pattern: /_UNAVAILABLE_FOR_PROVIDER$/,
    statuses: [409],
    meaning: 'the provider of the subscription has no price'
  },
  {
    pattern: /(^|_)NOT_FOUND$/,
    statuses: [404, 422],
    meaning: 'no target resource (404), or no record that the body names (422)'
  },
  { pattern: /_NOT_ASSIGNED$/, statuses: [404], meaning: 'no such membership' },
  {
    pattern: /^UNKNOWN_/,
    statuses: [422],
    meaning: 'the body names a record that does not exist'
  },
  {
    pattern: /_TOKEN_EXPIRED$/,
    statuses: [422],
    meaning: 'a token in the body has expired'
  },
  {
    pattern: /_OUT_OF_RANGE$/,
    statuses: [422],
    meaning: 'a value in the body is outside its range'
  },
  {
    pattern: /_LOCKED$/,
    statuses: [423],
    meaning: 'the account is locked for a time'
  },
  { pattern: /_FORBIDDEN$/, statuses: [403], meaning: 'refused' },
  { pattern: /^CANNOT_/, statuses: [403], meaning: 'refused' },
  {
    pattern: /_SELF$/,
    statuses: [403],
    meaning: 'refused on the caller account'
  },
  {
    pattern: /_NOT_CONFIGURED$/,
    statuses: [500, 501],
    meaning: 'a feature (501) or a catalog row (500) has no configuration'
  },
  {
    pattern: /^PROVIDER_.*_FAILED$/,
    statuses: [502],
    meaning: 'a bad answer of the provider'
  },
  {
    pattern: /_TIMEOUT$/,
    statuses: [504],
    meaning: 'the provider did not answer in time'
  }
];

/**
 * Keys whose name follows no pattern, or whose status is an exception to the
 * pattern of its name. The key is `GROUP.NAME`.
 */
const UNPATTERNED: Readonly<Record<string, string>> = {
  'AUTH.INVALID_CREDENTIALS': 'a sign-in with wrong credentials (401)',
  'AUTH.EMAIL_NOT_VERIFIED':
    'sign-in refused until the address is proved (403)',
  'AUTH.USER_DEACTIVATED':
    'the credentials belong to a deactivated account (401)',
  'AUTH.USER_NOT_FOUND': 'a token names an account that no longer exists (401)',
  'AUTH.USER_NOT_FOUND_OR_DEACTIVATED':
    'an intent cookie names no usable account (401)',
  'AUTH.INVALID_VERIFICATION_TOKEN': 'a token in the body is not valid (422)',
  'AUTH.INVALID_RESET_TOKEN': 'a token in the body is not valid (422)',
  'AUTH.INVALID_REFRESH_TOKEN': 'the refresh credential is not valid (401)',
  'AUTH.SESSION_INVALIDATED':
    'the refresh credential predates a key rotation (401)',
  'AUTH.SESSION_EXPIRED': 'the refresh credential outlived the session (401)',
  'AUTH.TOKEN_REVOKED': 'the credential was revoked (401)',
  'AUTH.TOKEN_INVALIDATED_ROTATION':
    'the access token predates a key rotation (401)',
  'AUTH.INVALID_TOKEN': 'the access token is not valid (401)',
  'AUTH.INVALID_OAUTH_PROVIDER':
    'the provider in the path does not exist (404)',
  'AUTH.MISSING_OAUTH_DATA': 'the sign-in handoff credential is missing (401)',
  'AUTH.INVALID_OAUTH_DATA':
    'the sign-in handoff credential is not valid (401)',
  'AUTH.UNLINK_LAST_PROVIDER': 'the account state refuses the unlink (409)',
  'AUTH.OAUTH_PROVIDER_NOT_LINKED': 'the link in the path does not exist (404)',
  'AUTH.INVALID_CURRENT_PASSWORD': 'the step-up proof is not enough (403)',
  'AUTH.CAPTCHA_REQUIRED': 'the body has no captcha token (422)',
  'AUTH.CAPTCHA_INVALID': 'the captcha token in the body is not valid (422)',
  'AUTH.CAPTCHA_GATE_FAILURE': 'a configuration defect (500)',
  'AUTH.REAUTH_REQUIRED': 'the step-up proof is not enough (403)',
  'AUTH.PASSWORD_BREACHED': 'a password in the body fails a check (422)',
  'AUTH.PASSWORD_TOO_COMMON': 'a password in the body fails a check (422)',
  'AUTH.MFA_UNAVAILABLE': 'this server is not configured for the feature (501)',
  'AUTH.MFA_NOT_ENABLED': 'the account state refuses the request (409)',
  'AUTH.MFA_SETUP_REQUIRED': 'the account state refuses the request (409)',
  'AUTH.MFA_INVALID_CODE': 'the second factor of a sign-in is not valid (401)',
  'AUTH.MFA_STEP_UP_INVALID_CODE': 'the step-up proof is not enough (403)',
  'AUTH.MFA_ENROLMENT_INVALID_CODE': 'a code in the body fails a check (422)',
  'AUTH.MFA_INVALID_RECOVERY_CODE':
    'the second factor of a sign-in is not valid (401)',
  'AUTH.MFA_INVALID_PENDING_TOKEN':
    'the sign-in challenge credential is not valid (401)',
  'AUTH.MFA_ENROLMENT_REQUIRED': 'refused until a second factor is on (403)',
  'AUTH.SESSION_IS_CURRENT': 'refused on the session of the caller (403)',
  'AUTH.REFRESH_TOKEN_REQUIRED': 'the refresh credential is missing (401)',
  'ROLES.CONDITION_NOT_APPLICABLE':
    'a condition in the body fails a check (422)',
  'ROLES.CONDITION_NOT_SUPPORTED':
    'a condition in the body fails a check (422)',
  'ROLES.CONDITION_FIELD_UNKNOWN':
    'a condition in the body fails a check (422)',
  'ROLES.ACTION_NOT_GRANTABLE': 'a grant in the body fails a check (422)',
  'ROLES.CONDITION_BROADER_THAN_CALLER': 'refused: the caller holds less (403)',
  'ROLES.CONDITION_UNRESOLVABLE': 'refused: the caller cannot grant it (403)',
  'RESOURCES.CANNOT_RESTORE':
    'the server state refuses the restore, and the code can change it (409)',
  'RESOURCES.SUBJECT_RESERVED': 'a name in the body fails a check (422)',
  'RESOURCES.ACTION_NOT_DECLARED': 'an action in the body fails a check (422)',
  'FEATURE_FLAGS.VERSION_CONFLICT': 'an If-Match condition is false (412)',
  'FEATURE_FLAGS.IF_MATCH_REQUIRED':
    'a required precondition header is missing (428)',
  'FEATURE_FLAGS.IF_MATCH_INVALID': 'a header has bad syntax (400)',
  'FEATURE_FLAGS.INVALID_RULE': 'a rule in the body fails a check (422)',
  'BILLING.REGION_UNAVAILABLE': 'refused in that region (403)',
  'BILLING.REGION_CHANGE_BLOCKED':
    'the subscription state refuses the change (409)',
  'BILLING.PROVIDER_UNAVAILABLE':
    'an operator closed the provider for a time (503)',
  'BILLING.CURRENT_PLAN_MISSING': 'a catalog defect (500)',
  'BILLING.AMOUNT_REQUIRED': 'the body has no amount (422)',
  'BILLING.NO_ACTIVE_SUBSCRIPTION':
    'the subscription of the caller does not exist (404)',
  'BILLING.SUBSCRIPTION_NOT_LINKED':
    'the subscription state refuses the request for now (409)',
  'BILLING.SUBSCRIPTION_NOT_CHANGEABLE':
    'the subscription state refuses the change (409)',
  'BILLING.SUBSCRIPTION_BUSY':
    'the subscription state refuses the change for now (409)',
  'BILLING.CANCELLATION_SCHEDULED':
    'the subscription state refuses the change (409)',
  'BILLING.RENEWAL_IN_PROGRESS':
    'the subscription state refuses the change for now (409)',
  'BILLING.PLAN_CHANGE_UNFINISHED':
    'the subscription state refuses the change (409)',
  'BILLING.ENTITLEMENT_REQUIRED': 'refused by the plan (403)',
  'BILLING.WEBHOOK_EVENT_NOT_REPLAYABLE':
    'the event state refuses the replay (409)',
  'BILLING.INVOICE_NOT_REFUNDABLE':
    'the invoice state refuses the refund (409)',
  'BILLING.CREDITS_BLOCKED': 'the credit balance refuses the usage (409)',
  'BILLING.CUSTOMER_NO_ACTIVE_SUBSCRIPTION':
    'the customer state refuses the usage (409)',
  'BILLING.METER_NOT_DECLARED': 'a meter in the body fails a check (422)',
  'BILLING.USAGE_BEFORE_OPEN_WINDOW': 'a time in the body fails a check (422)',
  'BILLING.USAGE_IN_FUTURE': 'a time in the body fails a check (422)',
  'BILLING.PROVIDER_STATE_UNCERTAIN': 'a bad answer of the provider (502)',
  'BILLING.PROVIDER_ERROR': 'a failed answer of the provider (502)',
  'BILLING.PAYMENT_DECLINED':
    'the payment method of the customer refuses the charge (409)',
  'BILLING.PAYMENT_METHOD_MISSING':
    'the customer state refuses the charge (409)',
  'DB.UNIQUE_VIOLATION': 'a taken value (409)',
  'DB.FOREIGN_KEY_VIOLATION': 'related rows refuse the change (409)',
  'DB.NOT_NULL_VIOLATION': 'the body has no value for a required field (422)',
  'DB.INVALID_INPUT': 'a value has bad syntax (400)',
  'GENERAL.INTERNAL_SERVER_ERROR': 'an unexpected condition (500)',
  'GENERAL.INSUFFICIENT_PERMISSIONS':
    'refused by the permissions of the caller (403)',
  'GENERAL.INVALID_CURSOR': 'a query parameter has bad syntax (400)'
};

/** Every key as `GROUP.NAME`, with its value. */
function namedKeys(): { name: string; value: string }[] {
  return Object.entries(ErrorKeys).flatMap(([group, keys]) =>
    Object.entries(keys).map(([key, value]) => ({
      name: `${group}.${key}`,
      value: value as string
    }))
  );
}

export function findProblems(
  keys: { name: string; value: string }[],
  statusOf: (value: string) => number | undefined,
  unpatterned: Readonly<Record<string, string>>
): string[] {
  const problems: string[] = [];
  for (const { name, value } of keys) {
    const status = statusOf(value);
    if (status === undefined) {
      problems.push(`${name}: no status in ERROR_STATUS`);
      continue;
    }
    if (name in unpatterned) {
      if (!unpatterned[name].trim()) {
        problems.push(`${name}: the UNPATTERNED entry gives no reason`);
      }
      continue;
    }
    const keyName = name.split('.')[1];
    const rule = RULES.find((r) => r.pattern.test(keyName));
    if (!rule) {
      problems.push(
        `${name}: the name follows no pattern; add it to UNPATTERNED with the reason for ${status}`
      );
    } else if (!rule.statuses.includes(status)) {
      problems.push(
        `${name}: status ${status}, but the name means ${rule.meaning} (${rule.statuses.join(' or ')})`
      );
    }
  }
  const known = new Set(keys.map((k) => k.name));
  for (const name of Object.keys(unpatterned)) {
    if (!known.has(name)) {
      problems.push(`${name}: in UNPATTERNED, but no such key exists`);
    }
  }
  return problems;
}

function selfTest(): void {
  const cases: {
    label: string;
    keys: { name: string; value: string }[];
    status: Record<string, number>;
    unpatterned: Record<string, string>;
    fails: boolean;
  }[] = [
    {
      label: 'a taken value with 400',
      keys: [{ name: 'ROLES.NAME_EXISTS', value: 'a' }],
      status: { a: 400 },
      unpatterned: {},
      fails: true
    },
    {
      label: 'a taken value with 409',
      keys: [{ name: 'ROLES.NAME_EXISTS', value: 'a' }],
      status: { a: 409 },
      unpatterned: {},
      fails: false
    },
    {
      label: 'a name with no pattern and no reason',
      keys: [{ name: 'AUTH.SOMETHING_NEW', value: 'a' }],
      status: { a: 400 },
      unpatterned: {},
      fails: true
    },
    {
      label: 'a stale UNPATTERNED entry',
      keys: [],
      status: {},
      unpatterned: { 'AUTH.GONE': 'reason' },
      fails: true
    }
  ];
  let failed = false;
  for (const c of cases) {
    const problems = findProblems(c.keys, (v) => c.status[v], c.unpatterned);
    const ok = problems.length > 0 === c.fails;
    console.log(`${ok ? 'ok' : 'FAIL'}: ${c.label}`);
    failed ||= !ok;
  }
  if (failed) process.exit(1);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const keys = namedKeys();
  const problems = findProblems(
    keys,
    (value) => (ERROR_STATUS as Record<string, number>)[value],
    UNPATTERNED
  );
  if (problems.length > 0) {
    console.error(`${problems.length} problem(s) in ERROR_STATUS:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`All ${keys.length} error keys have the status of their name.`);
}
