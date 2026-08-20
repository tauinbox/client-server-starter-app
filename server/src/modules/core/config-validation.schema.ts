import * as Joi from 'joi';
import {
  APP_ENVIRONMENTS,
  MIN_JWT_EXPIRATION_SECONDS
} from '@app/shared/constants';
import { DEFAULT_BILLING_PROVIDER_TIMEOUT_MS } from '../billing/providers/provider-deadline';
import {
  DEFAULT_WEBHOOK_PAYLOAD_RETENTION_DAYS,
  DEFAULT_WEBHOOK_RETENTION_DAYS
} from '../billing/webhooks/billing-webhook-queue.constants';

// Validated by ConfigModule at bootstrap: a malformed value or a missing
// required key aborts startup instead of degrading behavior at runtime.
// Joi also coerces values (e.g. numbers) and applies defaults, and
// ConfigService.get() reads the coerced result before raw process.env.
export const configValidationSchema = Joi.object({
  APPLICATION_PORT: Joi.number().default(3000),
  ENVIRONMENT: Joi.string()
    .valid(...APP_ENVIRONMENTS)
    .default('production'),
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_NAME: Joi.string().required(),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  JWT_ALGORITHM: Joi.string().valid('HS256', 'RS256').default('HS256'),
  JWT_SECRET: Joi.string().min(16).when('JWT_ALGORITHM', {
    is: 'RS256',
    then: Joi.optional(),
    otherwise: Joi.required()
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
  // Below the client's refresh window there is no interval to schedule, so
  // every open tab would refresh once per round trip.
  JWT_EXPIRATION: Joi.number().min(MIN_JWT_EXPIRATION_SECONDS).required(),
  JWT_REFRESH_EXPIRATION: Joi.number().required(),
  AUDIT_LOG_RETENTION_DAYS: Joi.number().min(1).default(90),
  DB_POOL_MAX: Joi.number().min(1).default(10),
  DB_POOL_IDLE_TIMEOUT: Joi.number().min(0).default(30000),
  DB_POOL_CONNECTION_TIMEOUT: Joi.number().min(0).default(5000),
  TRUSTED_PROXIES: Joi.string().optional().allow(''),
  TURNSTILE_SITE_KEY: Joi.string().optional().allow(''),
  TURNSTILE_SECRET_KEY: Joi.string().optional().allow(''),
  SMTP_SECURE: Joi.string().valid('true', 'false').optional().allow(''),
  // Billing provider credentials — optional/empty by default so an
  // unconfigured provider simply makes billing unavailable. A provider
  // counts as configured only when both of its vars are set.
  PADDLE_API_KEY: Joi.string().optional().allow(''),
  PADDLE_WEBHOOK_SECRET: Joi.string().optional().allow(''),
  PADDLE_ENVIRONMENT: Joi.string()
    .valid('sandbox', 'production')
    .default('sandbox'),
  YOOKASSA_SHOP_ID: Joi.string().optional().allow(''),
  YOOKASSA_SECRET_KEY: Joi.string().optional().allow(''),
  YOOKASSA_VAT_CODE: Joi.number().integer().min(1).max(6).default(1),
  BILLING_DEFAULT_CURRENCY: Joi.string().valid('USD', 'RUB').default('USD'),
  // Deadline for a single provider API call. Neither SDK sets a transport
  // timeout, so without this a stalled socket blocks the sequential renewal
  // scan for as long as the peer keeps it open.
  BILLING_PROVIDER_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1)
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
});
