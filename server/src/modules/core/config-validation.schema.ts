import * as Joi from 'joi';
import {
  APP_ENVIRONMENTS,
  CAPTCHA_PROVIDERS,
  DATA_REGIONS,
  DEFAULT_SESSION_ABSOLUTE_MAX_MS,
  MIN_JWT_EXPIRATION_SECONDS,
  REGION_INTEGRATIONS,
  SMTP_PROVIDER_REGIONS,
  type CaptchaProvider,
  type DataRegion,
  type PeerRegions,
  type RegionIntegration
} from '@app/shared/constants';
import {
  DEFAULT_BILLING_PROVIDER_TIMEOUT_MS,
  MAX_BILLING_PROVIDER_TIMEOUT_MS
} from '../billing/providers/provider-deadline';
import {
  DEFAULT_WEBHOOK_PAYLOAD_RETENTION_DAYS,
  DEFAULT_WEBHOOK_RETENTION_DAYS
} from '../billing/webhooks/billing-webhook-queue.constants';

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

const PEER_REGIONS_SCHEMA = Joi.object()
  .pattern(
    Joi.string().valid(...DATA_REGIONS),
    Joi.string().uri({ scheme: ['https'] })
  )
  .prefs({ errors: { label: 'key' } });

// A cell cannot be its own peer: the client would send a user of this region
// to this cell again.
function refuseOwnRegionAsPeer(
  env: { DATA_REGION?: DataRegion; PEER_REGIONS?: PeerRegions },
  helpers: Joi.CustomHelpers
): unknown {
  const { DATA_REGION: region, PEER_REGIONS: peers = {} } = env;

  return region && Object.hasOwn(peers, region)
    ? helpers.message({
        custom: 'PEER_REGIONS must not name the own DATA_REGION'
      })
    : env;
}

const CAPTCHA_PROVIDER_ENV_KEYS: Record<CaptchaProvider, readonly string[]> = {
  turnstile: ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY']
};

// Any one of these set counts as enabled, so a stray key of a provider that
// may not run in this region refuses the boot as well.
const INTEGRATION_ENV_KEYS: Record<RegionIntegration, readonly string[]> = {
  paddle: ['PADDLE_API_KEY', 'PADDLE_WEBHOOK_SECRET', 'PADDLE_CLIENT_TOKEN'],
  yookassa: ['YOOKASSA_SHOP_ID', 'YOOKASSA_SECRET_KEY'],
  turnstile: CAPTCHA_PROVIDER_ENV_KEYS.turnstile,
  googleOAuth: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  facebookOAuth: ['FACEBOOK_CLIENT_ID', 'FACEBOOK_CLIENT_SECRET'],
  vkOAuth: ['VK_CLIENT_ID', 'VK_CLIENT_SECRET']
};

function isSet(value: unknown): boolean {
  return typeof value === 'string' && value !== '';
}

function egressRefusals(env: Record<string, unknown>): string[] {
  const region = env['DATA_REGION'] as DataRegion | undefined;

  if (!region) return [];

  const integrations = Object.keys(INTEGRATION_ENV_KEYS) as RegionIntegration[];
  const refusals = integrations.flatMap((integration) => {
    const allowed: readonly DataRegion[] = REGION_INTEGRATIONS[integration];
    const setKeys = INTEGRATION_ENV_KEYS[integration].filter((key) =>
      isSet(env[key])
    );

    return setKeys.length > 0 && !allowed.includes(region)
      ? [
          `${integration} may not run in DATA_REGION ${region} (${setKeys.join(', ')} set)`
        ]
      : [];
  });

  if (isSet(env['SMTP_HOST'])) {
    const smtpRegion = env['SMTP_REGION'] as DataRegion | undefined;
    const accepted: readonly DataRegion[] = SMTP_PROVIDER_REGIONS[region];

    if (!smtpRegion) {
      refusals.push('SMTP_REGION is required when SMTP_HOST is set');
    } else if (!accepted.includes(smtpRegion)) {
      refusals.push(
        `an SMTP provider in ${smtpRegion} may not serve DATA_REGION ${region}`
      );
    }
  }

  return refusals;
}

// Personal data must not leave the jurisdiction of the cell through an
// integration (architecture section 12.5).
function refuseEgressOutsideRegion(
  env: Record<string, unknown>,
  helpers: Joi.CustomHelpers
): unknown {
  const refusals = egressRefusals(env);

  return refusals.length > 0
    ? helpers.message({ custom: refusals.join('; ') })
    : env;
}

function captchaRefusals(env: Record<string, unknown>): string[] {
  const selected = env['CAPTCHA_PROVIDER'] as CaptchaProvider | undefined;

  return CAPTCHA_PROVIDERS.flatMap((provider) => {
    const keys = CAPTCHA_PROVIDER_ENV_KEYS[provider];

    if (provider === selected) {
      const missing = keys.filter((key) => !isSet(env[key]));

      return missing.length > 0
        ? [`CAPTCHA_PROVIDER ${provider} requires ${missing.join(', ')}`]
        : [];
    }

    const stray = keys.filter((key) => isSet(env[key]));

    return stray.length > 0
      ? [`${stray.join(', ')} set, but CAPTCHA_PROVIDER is not ${provider}`]
      : [];
  });
}

// The captcha is on only by an explicit choice: half a key pair does not
// silently switch it off, and a key of a vendor that the cell did not select
// does not stay in the env unnoticed.
function refuseIncompleteCaptcha(
  env: Record<string, unknown>,
  helpers: Joi.CustomHelpers
): unknown {
  const refusals = captchaRefusals(env);

  return refusals.length > 0
    ? helpers.message({ custom: refusals.join('; ') })
    : env;
}

// Validated by ConfigModule at bootstrap: a malformed value or a missing
// required key aborts startup instead of degrading behavior at runtime.
// Joi also coerces values (e.g. numbers) and applies defaults, and
// ConfigService.get() reads the coerced result before raw process.env.
export const configValidationSchema = Joi.object({
  APPLICATION_PORT: Joi.number().default(3000),
  ENVIRONMENT: Joi.string()
    .valid(...APP_ENVIRONMENTS)
    .default('production'),
  // No default: a cell that guessed its region could store the personal data
  // of one jurisdiction in the database of another.
  DATA_REGION: Joi.string()
    .valid(...DATA_REGIONS)
    .required(),
  // JSON object of region to the public https URL of that cell. Joi.object()
  // does not parse a JSON string, so the rule parses it. The rule at the end
  // of the schema refuses the own region.
  PEER_REGIONS: Joi.string()
    .empty('')
    .default({})
    .custom((raw: string, helpers) => {
      const result = PEER_REGIONS_SCHEMA.validate(parseJson(raw));

      return result.error
        ? helpers.error('any.invalid', { reason: result.error.message })
        : (result.value as PeerRegions);
    })
    .messages({ 'any.invalid': '{{#label}} is invalid: {{#reason}}' }),
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_NAME: Joi.string().required(),
  // The server logs in with the role of each data source. DB_USER and
  // DB_PASSWORD are the administrator login of the boot steps only: the
  // entrypoint starts the server without DB_PASSWORD.
  DB_REGIONAL_PASSWORD: Joi.string().required(),
  DB_SETTINGS_PASSWORD: Joi.string().required(),
  JWT_ALGORITHM: Joi.string().valid('HS256', 'RS256').default('HS256'),
  JWT_SECRET: Joi.string().when('JWT_ALGORITHM', {
    is: 'RS256',
    then: Joi.optional(),
    // RFC 7518 section 3.2: an HS256 key must be at least the hash output size,
    // that is 256 bits. The floor stays off the RS256 branch, where the value is
    // unused, so a legacy secret in the file cannot refuse the boot.
    otherwise: Joi.string().min(32).required()
  }),
  JWT_PRIVATE_KEY: Joi.string().when('JWT_ALGORITHM', {
    is: 'RS256',
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  JWT_PUBLIC_KEY: Joi.string().when('JWT_ALGORITHM', {
    is: 'RS256',
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  JWT_MIN_IAT: Joi.number().integer().min(0).optional(),
  // Base64 of 32 raw bytes, which is 44 characters with padding. Optional:
  // without it two-factor enrolment is refused rather than performed with a
  // secret nobody can protect. A present but malformed value is a
  // configuration error and must abort the boot, which is what this validates.
  MFA_ENCRYPTION_KEY: Joi.string().base64().length(44).optional().allow(''),
  // Opt-in: an account holding a super role reaches no route behind
  // `@Authorize` until it has enrolled a second factor. It stays inert while
  // MFA_ENCRYPTION_KEY is empty, because enrolment answers
  // `MFA_UNAVAILABLE` in that state.
  MFA_REQUIRED_FOR_ADMINS: Joi.string()
    .valid('true', 'false')
    .optional()
    .allow(''),
  // Below the client's refresh window there is no interval to schedule, so
  // every open tab would refresh once per round trip.
  JWT_EXPIRATION: Joi.number().min(MIN_JWT_EXPIRATION_SECONDS).required(),
  JWT_REFRESH_EXPIRATION: Joi.number().required(),
  // The floor and the rising default both keep an abort about a value the
  // operator chose: under the refresh window a cap ends a session sooner than
  // JWT_REFRESH_EXPIRATION promises, and the constant must not refuse a longer
  // window. 0 disables the cap.
  SESSION_ABSOLUTE_MAX_MS: Joi.alternatives()
    .try(
      Joi.number().valid(0),
      Joi.number()
        .integer()
        .min(
          Joi.ref('JWT_REFRESH_EXPIRATION', {
            adjust: (seconds: number) => Number(seconds) * 1000
          })
        )
        .messages({
          'number.min':
            'SESSION_ABSOLUTE_MAX_MS must be 0 or at least JWT_REFRESH_EXPIRATION * 1000'
        })
    )
    .default((parent: Record<string, unknown>) => {
      const refreshWindowMs = Number(parent['JWT_REFRESH_EXPIRATION']) * 1000;

      return Number.isFinite(refreshWindowMs)
        ? Math.max(DEFAULT_SESSION_ABSOLUTE_MAX_MS, refreshWindowMs)
        : DEFAULT_SESSION_ABSOLUTE_MAX_MS;
    }),
  AUDIT_LOG_RETENTION_DAYS: Joi.number().min(1).default(90),
  // Divided between the regional and the settings pool (splitPoolMax), each
  // with at least one connection.
  DB_POOL_MAX: Joi.number().min(2).default(10),
  DB_POOL_IDLE_TIMEOUT: Joi.number().min(0).default(30000),
  DB_POOL_CONNECTION_TIMEOUT: Joi.number().min(0).default(5000),
  TRUSTED_PROXIES: Joi.string().optional().allow(''),
  GEOIP_DB_PATH: Joi.string().optional().allow(''),
  // Empty: no captcha. The rule at the end of the schema requires the keys of
  // the selected provider and refuses the keys of any other.
  CAPTCHA_PROVIDER: Joi.string()
    .valid(...CAPTCHA_PROVIDERS)
    .empty('')
    .optional(),
  TURNSTILE_SITE_KEY: Joi.string().optional().allow(''),
  TURNSTILE_SECRET_KEY: Joi.string().optional().allow(''),
  SMTP_SECURE: Joi.string().valid('true', 'false').optional().allow(''),
  // The region of the SMTP provider, declared by the operator, because the
  // host name does not tell it. Required when SMTP_HOST is set (rule at the
  // end of the schema).
  SMTP_REGION: Joi.string()
    .valid(...DATA_REGIONS)
    .empty('')
    .optional(),
  // Billing provider credentials — optional/empty by default so an
  // unconfigured provider simply makes billing unavailable. A provider
  // counts as configured only when both of its vars are set.
  PADDLE_API_KEY: Joi.string().optional().allow(''),
  PADDLE_WEBHOOK_SECRET: Joi.string().optional().allow(''),
  // Public client-side token for Paddle.js (test_... or live_...), not a
  // credential. Without it the browser cannot open a Paddle checkout.
  PADDLE_CLIENT_TOKEN: Joi.string().optional().allow(''),
  PADDLE_ENVIRONMENT: Joi.string()
    .valid('sandbox', 'production')
    .default('sandbox'),
  YOOKASSA_SHOP_ID: Joi.string().optional().allow(''),
  YOOKASSA_SECRET_KEY: Joi.string().optional().allow(''),
  YOOKASSA_VAT_CODE: Joi.number().integer().min(1).max(6).default(1),
  BILLING_DEFAULT_CURRENCY: Joi.string().valid('USD', 'RUB').default('USD'),
  // Deadline for a single provider API call. Neither SDK sets a transport
  // timeout, so without this a stalled socket blocks the sequential renewal
  // scan for as long as the peer keeps it open. The maximum keeps a plan change
  // inside the lease that holds the renewal scan off its subscription.
  BILLING_PROVIDER_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1)
    .max(MAX_BILLING_PROVIDER_TIMEOUT_MS)
    .default(DEFAULT_BILLING_PROVIDER_TIMEOUT_MS),
  // Syntax (IP/CIDR per entry) is validated by
  // WebhookIpAllowlistGuard, which throws at bootstrap on a
  // malformed entry.
  BILLING_WEBHOOK_IP_ALLOWLIST: Joi.string().optional().allow(''),
  BILLING_WEBHOOK_RETENTION_DAYS: Joi.number()
    .integer()
    .min(1)
    .default(DEFAULT_WEBHOOK_RETENTION_DAYS),
  // Only meaningful below BILLING_WEBHOOK_RETENTION_DAYS: above it the row is
  // deleted before its payload would ever be dropped.
  BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS: Joi.number()
    .integer()
    .min(1)
    .default(DEFAULT_WEBHOOK_PAYLOAD_RETENTION_DAYS)
})
  .custom(refuseOwnRegionAsPeer)
  .custom(refuseIncompleteCaptcha)
  .custom(refuseEgressOutsideRegion);
