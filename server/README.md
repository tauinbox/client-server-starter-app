# Server

A NestJS 11 REST API. It has JWT authentication, PostgreSQL through TypeORM, and Swagger
documentation.

## Getting Started

```bash
npm install
cp .env.example .env      # Configure database and JWT settings
docker compose up -d       # Start backing services (Postgres + Redis + Mailpit)
npm run build
npm run migrations:run     # Apply database schema
npm run seed:run           # Optional: seed sample data
npm run start:dev          # Dev server at http://localhost:3000
```

`server/docker-compose.yml` is the local **dev** stack. It holds Postgres on `:5432`, Redis on
`:6379`, and Mailpit with SMTP on `:1025` and a UI on `:8025`.

That file is different from the `docker-compose.yml` file in the root of the repository. The root
file is the **production** deployment, and you must not run it locally.

Redis and Mailpit are optional. Set `REDIS_URL` to enable the queue and the cache. Set `SMTP_HOST`
and `SMTP_PORT` to capture mail in Mailpit. Refer to [Email](#email-mailmodule).

**An alternative for development.** Use the mock-server. It needs no database:

```bash
cd mock-server
npm install
npm run start:dev          # Starts in-memory Express API on port 3000 (watch mode)
```

## Commands

| Task | Command |
|------|---------|
| Dev server | `npm run start:dev` (port 3000, watch mode) |
| Production start | `npm run start:prod` |
| Build | `npm run build` |
| Typecheck | `npm run typecheck` runs `tsc --noEmit` over the full `tsconfig.json`. Thus it covers `test/`, `*.spec.ts`, `common/testing/` and `eslint.config.ts`. `tsconfig.build.json` excludes those files from `npm run build` |
| Lint | `npm run lint` |
| Lint fix | `npm run lint:fix` |
| Format check | `npm run format:check` covers `src/`, `test/`, `scripts/` and the root configuration files. It also covers `shared/src/` and the root-level `*.mjs` configuration files |
| Format | `npm run format` uses the same scope and writes the corrections |
| Unit tests | `npm test` |
| Single test | `npx jest --testPathPattern=<pattern>` |
| Test watch | `npm run test:watch` |
| Test coverage | `npm run test:cov` |
| E2E tests | `npm run test:e2e` |
| Run migrations | `npm run migrations:run` (build first) |
| Generate migration | `npm run migrations:gen -- ./src/migrations/<kebab-name>` (build first) |
| Revert migration | `npm run migrations:revert` (build first) |
| Run seeders | `npm run seed:run` (build first) |
| Validate i18n keys | `npm run check:i18n` verifies that each `ErrorKeys` value exists in each client i18n JSON file. CI applies it in the `Server - Checks` job. Thus a new error key with no translation fails the build |
| Generate CASL subjects | `npm run generate:subjects` scans the `@RegisterResource` decorators and writes `shared/src/generated/casl-subjects.ts`. Run it when you add a new resource |
| Report grants against the grant-scope rule | `npm run check:grant-scope` is read-only. Refer to the description below the table |
| Audit role-permission conditions | `npm run check:role-conditions` finds each `role_permissions.conditions.custom` row that holds an operator or a field that the SQL translator (`apply-ability.util.ts`) cannot handle. Run it against a staging dump before you deploy a change to the translator |
| Audit dependencies | `npm run audit:ci` runs `npm audit --audit-level=high --omit=dev` through `scripts/audit-ci.mjs`. This is the same gate that CI applies. Refer to the description below the table |

**`npm run check:grant-scope`.** The grant-scope rule applies to a write only. The server never
validates a row that is already in `role_permissions` again, because a retro-validation of a live
grant removes permissions in production silently.

This report closes that gap. It lists two groups. The first group holds each grant whose stored
condition the resolver vetoes, which is inert today. The second group holds each grant that its
author, from the `PERMISSION_ASSIGN` audit trail, could not authorize today. The report runs those
grants through the true `assertCanGrantPermissions` function.

The attribution depends on the audit trail, which the system prunes after
`AUDIT_LOG_RETENTION_DAYS`. The report also evaluates the abilities as they are now. Thus a verdict
is evidence to review and not proof. The command exits with 1 when it finds something.

**`npm run audit:ci`.** The command fails on a high or critical advisory. A moderate finding passes.

Run it before each push. An advisory comes from the dependency tree, thus the command can fail with
no change in the source.

The wrapper retries a maximum of 3 times, 15 s apart. It retries **only** when the advisory endpoint
of the registry gives an error. A true finding still fails on the first attempt.

## Environment Configuration

Copy `.env.example` to `.env`, and then configure it:

| Variable | Default | Description |
|----------|---------|-------------|
| `APPLICATION_PORT` | `3000` | HTTP listen port |
| `ENVIRONMENT` | `local` | Environment name. The value `local` enables the automatic schema sync and a permissive CORS policy |
| `SWAGGER_ENABLED` | - | Set it to `true` to enable the Swagger UI in staging or in production. It is always on in `local` and `development` |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `my-db` | Database name |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | `password` | Database password |
| `DB_SCHEMA` | `public` | Database schema |
| `DB_LOGGING` | `["warn","error","slow"]` | TypeORM logging levels. The value `"slow"` logs a query that takes more than `DB_SLOW_QUERY_THRESHOLD` |
| `DB_SLOW_QUERY_THRESHOLD` | `200` | Slow query threshold in milliseconds |
| `DB_LOGGER` | - | TypeORM logger type, for example `advanced-console` or `file`. A value replaces the default logger |
| `REQUEST_LOG_LEVEL` | `all` | Request logging level. `all` logs each request. `warn` logs a 4xx and a 5xx. `error` logs a 5xx |
| `JWT_ALGORITHM` | `RS256` | Signing algorithm: `HS256` (symmetric) or `RS256` (asymmetric) |
| `JWT_SECRET` | - | Symmetric secret, a minimum of 16 characters. It is necessary when `JWT_ALGORITHM=HS256` |
| `JWT_PRIVATE_KEY` | - | RSA private key PEM in base64. It is necessary when `JWT_ALGORITHM=RS256` |
| `JWT_PUBLIC_KEY` | - | RSA public key PEM in base64. It is necessary when `JWT_ALGORITHM=RS256` |
| `JWT_MIN_IAT` | - | A Unix timestamp. The server rejects a token that it issued before this value. Use it during key rotation |
| `JWT_EXPIRATION` | `3600` | Access token lifetime in seconds, that is 1 h. The minimum is `120`, because the client refreshes 60 s before the expiry |
| `JWT_REFRESH_EXPIRATION` | `604800` | Refresh token lifetime in seconds, that is 7 days |
| `GOOGLE_CLIENT_ID` | - | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | - | Google OAuth client secret |
| `FACEBOOK_CLIENT_ID` | - | Facebook OAuth client ID |
| `FACEBOOK_CLIENT_SECRET` | - | Facebook OAuth client secret |
| `VK_CLIENT_ID` | - | VK OAuth client ID |
| `VK_CLIENT_SECRET` | - | VK OAuth client secret |
| `CLIENT_URL` | `http://localhost:4200` | Client URL for the OAuth callback redirects |
| `MFA_ENCRYPTION_KEY` | - | Base64 of 32 random bytes. It encrypts the two-factor secret column with AES-256-GCM, because a code check needs the original secret back and thus a hash is the wrong tool. While the value is empty, two-factor enrolment answers HTTP 503 and the rest of the application is unchanged. A value that decodes to any other length stops the boot |
| `MFA_REQUIRED_FOR_ADMINS` | `false` | Set to `true` to make two-factor authentication mandatory for every account that holds a super role. Such an account signs in and reaches its profile as before, but no route behind an authorization check answers it until the enrolment is complete. The requirement stays off while `MFA_ENCRYPTION_KEY` is empty, because enrolment is unavailable in that state |
| `ADMIN_EMAIL` | - | Email address of the initial administrator. The server makes the account at startup when it does not exist. It skips this step when the value is empty |
| `ADMIN_PASSWORD` | - | Password of the initial administrator |
| `ADMIN_FIRST_NAME` | `Admin` | First name of the initial administrator |
| `ADMIN_LAST_NAME` | `User` | Last name of the initial administrator |
| `SMTP_HOST` | - | SMTP server host. When it is empty, the server writes each email to the console |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_SECURE` | - | The value `true` forces implicit TLS. When it is empty, the server uses STARTTLS on port 587 and implicit TLS on port 465. TLS is always necessary |
| `SMTP_USER` | - | SMTP username |
| `SMTP_PASS` | - | SMTP password |
| `SMTP_FROM` | `noreply@example.com` | Sender email address |
| `REDIS_URL` | - | Redis connection URL. It is optional. It enables distributed rate limiting and a shared permission cache for a deployment with more than one instance |
| `E2E_REDIS_DB` | `15` | For a test only. `npm run test:e2e` uses this logical Redis database, and it clears the database before each run. The value must not be `0`. Refer to [E2E Tests](#e2e-tests-jest) |
| `AUDIT_LOG_RETENTION_DAYS` | `90` | Days to keep an audit log entry before the nightly deletion |
| `TURNSTILE_SITE_KEY` | - | Cloudflare Turnstile site key, which is public. The two Turnstile keys are necessary before the CAPTCHA operates. Refer to [Enabling CAPTCHA in production](#enabling-captcha-in-production) |
| `TURNSTILE_SECRET_KEY` | - | Cloudflare Turnstile secret key. The CAPTCHA stays disabled while one of the two keys is empty |
| `PWNED_PASSWORDS_RANGE_URL` | `https://api.pwnedpasswords.com/range` | Range endpoint of the breached-password blocklist. Every path that SETS a password asks it, sending only the first five hex characters of the SHA-1 of the candidate. Point it at a self-hosted mirror when outbound access to the default host is closed. The check fails open, so an unreachable endpoint accepts the password and increments `password_breach_lookups_total{outcome="unavailable"}` |
| `DB_POOL_MAX` | `10` | Maximum size of the PostgreSQL connection pool |
| `DB_POOL_IDLE_TIMEOUT` | `30000` | Milliseconds before the pool closes an idle connection |
| `DB_POOL_CONNECTION_TIMEOUT` | `5000` | Milliseconds to wait for a connection before an error |
| `CORS_ORIGINS` | - | Permitted origins, separated by commas, for example `https://app.example.com,https://admin.example.com`. Production rejects the value `*` |
| `TRUSTED_PROXIES` | - (local), `loopback,uniquelocal` (docker-compose) | The Express `trust proxy` setting. It is necessary behind a reverse proxy, thus `req.ip` gives the true client. Refer to [Deployment behind a reverse proxy](#deployment-behind-a-reverse-proxy). It accepts `loopback`, `linklocal`, `uniquelocal`, a list of IPs and CIDRs separated by commas, a hop count such as `1`, or `true`. The application has no built-in default, thus an empty value disables the setting. The `docker-compose.yml` file of the repository sets `loopback,uniquelocal` for a production deployment behind a host-local reverse proxy or a docker-bridge sidecar. To change it, export `TRUSTED_PROXIES` in the shell |
| `PADDLE_API_KEY` | - | Paddle server API key. Use it with `PADDLE_WEBHOOK_SECRET`. The two values are necessary before Paddle counts as configured |
| `PADDLE_WEBHOOK_SECRET` | - | Paddle webhook HMAC secret for the signature verification |
| `PADDLE_ENVIRONMENT` | `sandbox` | Paddle API host: `sandbox` or `production` |
| `YOOKASSA_SHOP_ID` | - | YooKassa shop ID. Use it with `YOOKASSA_SECRET_KEY`. The two values are necessary before YooKassa counts as configured |
| `YOOKASSA_SECRET_KEY` | - | YooKassa secret key |
| `YOOKASSA_VAT_CODE` | `1` | VAT code on each 54-FZ receipt line. The range is 1 to 6, and the value depends on the tax regime. The value `1` means "no VAT" |
| `BILLING_DEFAULT_CURRENCY` | `USD` | Default billing currency of a new customer: `USD` or `RUB`. The billing UI stays hidden until a person configures a minimum of one provider |
| `BILLING_PROVIDER_TIMEOUT_MS` | `20000` | Deadline of one provider API call. Neither SDK sets a transport timeout. Without this deadline, a stalled socket blocks the sequential renewal scan and holds a webhook delivery open with no end. The deadline bounds our call and not the request of the provider |
| `BILLING_WEBHOOK_IP_ALLOWLIST` | - (local), provider egress ranges (docker-compose) | IPs and CIDRs that can call `/billing/webhooks/*`, separated by commas. Each other source gets a `403` before any webhook processing. An empty value disables the check. A malformed entry stops the startup. Behind a reverse proxy the check needs `TRUSTED_PROXIES`. Refer to [Billing webhook source-IP allowlist](#billing-webhook-source-ip-allowlist) |
| `BILLING_WEBHOOK_RETENTION_DAYS` | `90` | The age, from `received_at`, at which the daily sweep deletes a settled webhook delivery from the idempotency ledger. The sweep never deletes a `received` row or a `dead_letter` row. The sweep is a queue job, thus it runs only with `REDIS_URL` set |
| `BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS` | `7` | The age at which the sweep clears the stored event of a settled delivery, before it deletes the row. The system never replays a `processed` row, thus it keeps the payload for this time for triage only. Set this value below `BILLING_WEBHOOK_RETENTION_DAYS`. If not, the sweep deletes the row before it clears the payload |

## Architecture

### Module Structure

```
src/
├── common/
│   ├── dtos/               # CursorPaginationQueryDto, CursorPaginatedResponseDto<T>,
│   │                       #   EntityCursorQueryDto
│   ├── utils/              # escapeLikePattern, hashToken, withTransaction,
│   │                       #   extractAuditContext, cursor encode/decode,
│   │                       #   applyKeysetPagination, cache-version-counter,
│   │                       #   money-column.transformer
│   ├── validators/         # is-safe-mongo-query, permission-condition-shape,
│   │                       #   property-is-defined
│   └── upload/             # createDiskStorageOptions()
└── modules/
    ├── core/               # Dynamic root module: config, cache, database, filters,
    │                       #   health, metrics, schedule
    ├── auth/               # Authentication, OAuth, RBAC resource catalog
    ├── audit/              # Audit log service, decorator, interceptor, entity
    ├── mail/               # Email delivery
    ├── roles/              # Roles, permissions, CASL ability factory, guards
    ├── notifications/      # SSE push hub
    ├── feature-flags/      # Flag entities, resolver, admin API, guard, middleware
    ├── billing/            # Subscriptions, invoices, providers, rating, renewals,
    │                       #   webhooks, credits, one-time purchases
    ├── entitlements/       # EntitlementService and EntitlementGuard, a peer of auth
    │                       #   and billing
    └── users/              # User CRUD
```

The subsections below give the detail of each directory.

#### common

`common/dtos/` holds the cursor pagination DTOs. Each list endpoint uses them.

`common/utils/` holds the shared utilities. They are `escapeLikePattern`, `hashToken`,
`withTransaction`, `extractAuditContext`, the cursor encoder and decoder, and
`applyKeysetPagination`. It also holds `cache-version-counter.ts` and
`money-column.transformer.ts`.

`common/validators/` holds `is-safe-mongo-query` and `permission-condition-shape`. It also holds
`property-is-defined.ts`.

`property-is-defined.ts` supplies the `@ValidateIf` condition. That condition replaces
`@IsOptional()` on an optional field whose consumer reads the value instead of a default. Three
examples of such a consumer are a NOT NULL column, a bounds check and a provider call. Thus an
explicit `null` is a 400 and the server does not pass it on. A DTO that `PartialType` builds passes
`{ skipNullProperties: false }` for the same reason.

`common/upload/` holds `createDiskStorageOptions()`. That is a reusable factory for a multer disk
storage. It takes the destination, the permitted extensions and the maximum file size. It validates
the file extension and the MIME type, thus a rename attack fails.

#### core

`config/` uses `@nestjs/config` and loads `.env`. `config-validation.schema.ts` holds the Joi
validation for the bootstrap. It coerces the types and applies the defaults. A malformed variable, or
a missing necessary variable, stops the startup.

`cache/` uses `@nestjs/cache-manager`. `redis-cache.store.ts` registers the `@keyv/redis` adapter
under the `stores` option, which is plural. The provider factory ignores a singular `store` option
silently, and the cache then degrades to an in-memory cache in each process.

The cache falls back to memory when `REDIS_URL` is empty. A connection timeout of 1 s stops an
unreachable Redis from holding a request, and the server then serves the data with no cache.

`database/` holds the TypeORM and PostgreSQL configuration.

`filters/` holds `GlobalExceptionFilter`. It gives a standard error response and maps a DB error.

`health/` holds `HealthModule`, with `GET /api/health/live` and `GET /api/health/ready`. The
readiness check pings the database. It also sends a Redis PING when `REDIS_URL` has a value or the
environment is production.

A dead Redis fails the readiness check, with a timeout of 2 s. A missing `REDIS_URL` in production
degrades to a generic warning, and an SMTP failure does the same. The server logs the raw SMTP error
and never returns it from the public endpoint.

The server keeps the SMTP verify result for 5 minutes behind an in-flight guard. Thus a probe does
not authenticate against the provider again at each request.

Each result also goes to the `dependency_up` gauge. That gauge is what makes a degraded dependency
alertable while readiness reports it as up.

`metrics/` holds `MetricsModule`, which is `@Global`. It supplies the Prometheus metrics through
`@willsoto/nestjs-prometheus`.

`GET /metrics` is outside the `/api` prefix. `InternalNetworkGuard` gates it: the server answers only
a request whose `req.ip` is a loopback, private or unique-local address, and it answers 403 to each
other source.

The metrics are `http_requests_total`, `http_request_duration_seconds`, `auth_events_total`,
`rbac_permission_denied_total{action,subject,level}`, `mail_queue_jobs{state}`,
`mail_jobs_processed_total{outcome}`, `db_pool_connections{state}`,
`cache_requests_total{cache,outcome}`, `billing_usage_records_unrated_total{meter}`,
`password_breach_lookups_total{outcome}` and
`dependency_up{dependency}`. The module also supplies `HttpMetricsInterceptor`.

`password_breach_lookups_total{outcome="unavailable"}` needs an alert. The breached-password check
fails open, so a blocklist that stops answering is silent in every other signal: registrations keep
succeeding and no error rate moves. That counter is the only place the gap shows.

`schedule/` uses `@nestjs/schedule` for the cron jobs.

#### auth

`controllers/` holds `AuthController`, which includes `GET /permissions`. It also holds
`OAuthController` and `RbacController`.

`services/` holds `AuthService`, `OAuthService`, `TokenGeneratorService`, `RefreshTokenService`,
`SessionIssuerService`, `SessionLimitService`, `OAuthAccountService`, `TokenCleanupService`,
`ResourceService`, `ActionService` and `ResourceSyncService`.

`SessionIssuerService.issueSession(user)` is the single place where a sign-in becomes a session. It
generates the tokens, persists the refresh token, and then prunes the sessions to the resolved
allowance. `AuthService.login` and `OAuthService.loginWithOAuth` both delegate to it and hold no
session logic. Thus the two paths cannot diverge.

Token rotation intentionally does NOT use that method. A rotation replaces a session instead of an
addition of one, and it runs no prune.

`SessionLimitService.maxSessionsFor(userId)` returns
`EntitlementService.limitFor(userId, 'sessions') ?? MAX_CONCURRENT_SESSIONS`. The concurrent-session
allowance is a plan dimension. Thus the sign-in path of the user cannot trim a paid allowance
silently. The method fails open: it catches a rejection from the resolver and uses the constant,
because a billing outage must never become a login outage.

`strategies/` holds `LocalStrategy`, `JwtStrategy` (which extracts the roles), `GoogleStrategy`,
`FacebookStrategy` and `VkStrategy`.

`guards/` holds `LocalAuthGuard`, `JwtAuthGuard`, and the Google, Facebook and VK OAuth guards. The
`createOAuthProviderGuard` factory makes the three OAuth guards.

`listeners/` holds three listeners. `SessionRevocationListener` reacts to
`UserSessionRevocationRequiredEvent`. It deletes the refresh tokens and stamps `tokenRevokedAt`. It
registers with `suppressErrors:false`, and the caller emits it with `emitAsync`. Thus a failed
revocation fails the request of the caller.

`UserDeletedListener` cleans up a pending email change. `UserRoleChangedListener` does the revocation
and the permission-cache invalidation after a role change.

`entities/` holds `RefreshToken`, `OAuthAccount`, `Resource` and `Action`.

`enums/` holds `OAuthProvider`.

`dto/` holds `LoginDto`, `RegisterDto`, `UpdateProfileDto`, `VerifyEmailDto`, `ForgotPasswordDto` and
`ResetPasswordDto`.

#### audit

`audit.service.ts` holds `AuditService`. It records 41 security-sensitive actions in the `audit_logs`
table.

`audit-cleanup.service.ts` holds `AuditCleanupService`. A nightly cron job deletes an entry that is
older than `AUDIT_LOG_RETENTION_DAYS` days.

`decorators/` holds
`@LogAudit({action,targetType,targetIdParam?,targetIdFromResponse?,details?})` for declarative audit
logging.

`interceptors/` holds `AuditLogInterceptor`. It is a global `APP_INTERCEPTOR`. It reads the
`@LogAudit` metadata and calls `logFireAndForget` after a success.

`entities/` holds the `AuditLog` entity, with `action`, `actorId`, `actorEmail`, `targetId`, `ip`,
`requestId` and `createdAt`.

#### mail

`mail.service.ts` sends the email messages for the verification and the password reset.

#### roles

`controllers/` holds `RolesController`. It has the CRUD operations, the permission operations and the
user assignment at `/api/v1/roles`.

`services/` holds `RoleService`, `PermissionService` and `PolicyEvaluatorService`.

`entities/` holds `Role`, `Permission` and `RolePermission`.

`guards/` holds `PermissionsGuard`. It resolves and checks the typed permissions, and an
administrator with a super role bypasses it.

`decorators/` holds `@RequirePermissions([Actions,Subjects])`, the composite
`@Authorize([action,subject])`, and `@RegisterResource`.

`casl/` holds three files. `app-ability.ts` holds `AppAbility`, `Actions`, `Subjects`, the
`PermissionCheck` types, the `SYSTEM_ABILITY` sentinel and the `AbilityOrSystem` union.
`CaslAbilityFactory` builds the `AppAbility` object, and `AuthController` uses it for
`GET /permissions`. `constants.ts` holds the reserved keywords. The build skips such a keyword for an
allow rule and keeps it for a deny rule.

#### notifications

`notifications.service.ts` manages a `Map<userId, Map<connectionId, Subject>>` structure. It supplies
`push(userId)` and `pushToAll()`.

`notifications.listener.ts` holds the `@OnEvent()` handlers. They react to `UserDeleted`,
`UserPasswordChanged`, `UserCreated`, `UserUpdated`, `UserRestored`, `UserRoleChanged` and
`UserRolePermissionsChanged`, and each one pushes a message.

`notifications.controller.ts` holds `GET /stream`. The `@Sse()` decorator returns an
`Observable<MessageEvent>` that merges with a heartbeat each 30 s.

#### feature-flags

`feature-flags.module.ts` registers `TypeOrmModule.forFeature([FeatureFlag, FeatureFlagRule])`. It
also registers `AnonIdMiddleware` globally through `configure()`.

`entities/` holds `FeatureFlag` and `FeatureFlagRule` with a cascade, plus their entity-contract
files.

`services/feature-flag.service.ts` holds the CRUD operations. A PATCH with `If-Match` gives a 409 on
an optimistic-lock conflict. The key check sits above the version comparison, because the version
goes into the `UPDATE ... WHERE` clause. Thus a request that is stale and duplicate-keyed gives
`errors.featureFlags.keyExists`. `replaceRules` runs in one transaction, and it validates each rule
payload after the 404 of `findOne`. The shape of a rule is validated above that point, by the
`ValidationPipe` on `ReplaceRulesDto`.

`services/feature-flag-resolver.service.ts` does the cached evaluation. A per-user key ends with the
shared `CacheVersionCounter` value (`common/utils/cache-version-counter.ts`). Thus a flag change
orphans each per-user entry with no Redis `SCAN`.

`services/attribute-registry.service.ts` is the extensibility seam. Another module calls
`registerAttribute(key, resolver)` from its `onModuleInit` method.

`controllers/feature-flags-admin.controller.ts` holds 9 administrator endpoints below
`/admin/feature-flags`. Each one uses `@Authorize(['manage','FeatureFlag'])`. The 5 mutating
endpoints each write an audit entry. Four of them use `@LogAudit`. The delete calls
`AuditService.log` itself, to record `details: { key }` of the flag that it removed. The 3 read
endpoints and `POST :id/preview` write nothing, thus they make no audit entry.

`controllers/feature-flags.controller.ts` holds `GET /feature-flags` with `@OptionalAuth()`. An
authenticated caller gets each flag that resolves true plus each public flag, and the server omits a
disabled non-public flag. An anonymous caller gets the public flags only.

`constants/feature-flag-metadata.constants.ts` holds `FEATURE_FLAG_KEY`. It lives here and not in the
decorator, thus the guard and the decorator do not import each other. Refer to the barrel and cycle
rules in the root README.

`decorators/require-feature.decorator.ts` holds the `@RequireFeature('key')` convenience decorator.
RBAC stays the true gate.

`guards/feature-flag.guard.ts` returns 404 against enumeration when the named flag is disabled for
the caller.

`middleware/anon-id.middleware.ts` issues the `nxs_anon_id` cookie at the first request. The cookie
uses `SameSite=Lax`, `Secure` in production, a life of 1 year and `httpOnly=false`.

`events/feature-flag-changed.event.ts` holds
`{ flagKey, changeType: 'created'|'updated'|'deleted'|'toggled'|'rules-replaced' }`.

`listeners/feature-flag-changed.listener.ts` reacts to `FeatureFlagChangedEvent`. It invalidates the
cache, increases the version, and calls `pushToAll` over SSE. It also does a per-user invalidation on
`UserRoleChangedEvent` and on `UserDeletedEvent`.

`utils/validate-rule-payload.util.ts` validates the payload of each rule type separately. It rejects
a custom attribute key that the registry does not hold. The value check itself is the shared
`attributeValueError`, which the mock server and the admin rule editor also call, thus the client
blocks a save that this file would reject. That shared function reads `toTimestamp` from
`shared/src/utils/feature-flag-timestamp.ts` and not from the evaluator, because the evaluator opens
with `node:crypto` and the client bundles the validator.

#### billing

The billing module is the foundation of the subscriptions. `CoreModule.forRoot()` starts it through
`BillingModule.forRoot()`.

**Module wiring (`billing.module.ts`).** The dynamic module imports `FeatureFlagsModule` and
`NotificationsModule`. It needs the second module because the entitlement-changed listener pushes to
the client of the affected user.

It also imports `TypeOrmModule.forFeature([...])` with these entities: `CreditBalance`,
`CreditLedger`, `Customer`, `CustomerGrant`, `Plan`, `Product`, `Subscription`, `Invoice`,
`PaymentMethod`, `UsageRecord`, `WebhookEvent` and `User`. The `User` entity is read-only here, and
the module needs it for the email address on a 54-FZ YooKassa receipt.

The module supplies the `BILLING_PROVIDERS`, `PADDLE_CLIENT` and `YOOKASSA_CLIENT` factories.

When `REDIS_URL` has a value, the module registers the billing-webhook BullMQ queue, its processor,
`WebhookReconciliationService` and `WebhookRetentionService`. The processor also schedules two
repeatable sweeps at bootstrap, that is the reconciliation sweep and the ledger retention sweep. It
skips the two sweeps in a test.

When `REDIS_URL` has a value and the process is not a test, the module also registers the
self-managed renewal queue and its processor. The renewal scan schedules itself at bootstrap.

The module imports `EntitlementsModule` and re-exports it. Thus an importer continues to resolve
`EntitlementService` and `EntitlementGuard` through `BillingModule`. The module exports
`BillingService`, `BillingConfigService`, `EntitlementsModule`, `UsageService` and `CreditService`.

**Geo-router (`billing.service.ts`).** `resolveProvider()` computes
`providerOverride ?? geoDefault(country)`. It answers 503 when the provider is disabled or not
configured. The file also holds the `geoDefaultFor()`, `effectiveProviderId()` and
`getProviderById()` helpers.

**Controllers.** `BillingPlansController` holds the `@Public()` route `GET /api/v1/billing/plans`. It
returns the active plans with the price of each provider.

`BillingUserController` uses JWT. Each route is scoped to `req.user`, thus IDOR fails. The routes
are:

- `GET subscription`, `GET invoices` (cursor-paginated) and `GET payment-method`.
- `GET usage` returns the metered-usage summary of the current period for a usage-mode subscription
  of the caller. It returns null for each other condition.
- `POST checkout` makes the local incomplete subscription for the self-managed provider, and then it
  redirects. It reuses an unpaid row that stays from an earlier attempt, through a conditional write
  that matches only while the row is `incomplete`. Thus a first-payment webhook that activates the
  row during the checkout gets a 409, and it does not reset a paid subscription. The release of a
  stale row on the provider-managed path uses the same guard.
- `POST subscription/change` does an immediate prorated change of the plan or of the mode.
  `POST subscription/change/preview` gives the cost and applies nothing.
- `POST subscription/cancel` cancels at the end of the period by default.
- `POST payment-method` starts the card replacement at the provider. Paddle gives its
  payment-method-change checkout. YooKassa does a zero-amount re-bind, and its webhook changes the
  default method. A `past_due` subscription can use this route, because it is how dunning recovers.
- `GET region` and `PUT region` read and write the `auto`, `ru` or `world` override. The write has an
  active-subscription guard, as in section 19 of the billing design.
- `GET products` returns the one-time catalog. It holds each active product that carries a price for
  the effective provider, that is a fixed-price `sku` or `credits` entry, and a `custom` entry whose
  price holds the donation bounds. The route resolves the provider without the availability
  assertion, thus the catalog stays readable.
- `POST purchase` makes a one-time purchase on the resolved provider. The server is the authority on
  the price of a fixed-price product. It validates a custom amount against the minimum and maximum of
  the product. It sanitizes the note of the buyer into the receipt.
- `GET credits` returns the prepaid credit balance of the caller. It returns null until the customer
  buys a pack.
- `GET entitlements` returns the access that the billing state of the caller gives, that is
  `planKey`, `capabilities` and `limits`. It is a separate read and not a field on `GET subscription`,
  which answers null in exactly the Free-plus-grant case. It is also not a field on `/auth/me`, which
  must continue to operate while the billing flag is off. The plan catalog cannot substitute for it,
  because the catalog expresses neither a one-time grant, nor the expiry of such a grant, nor the Free
  fallback, nor the `past_due` grace window.
- `GET premium-content` is the worked example of `@RequireEntitlement('reports')`.

`BillingAdminController` uses the CASL subject `Billing` through `@RegisterResource Billing`. Its
routes are:

- `GET subscriptions` and `GET invoices`. Each one takes a cursor DTO for its entity and returns the
  shared cursor envelope through `applyKeysetPagination`. Neither can return more than
  `MAX_PAGE_SIZE` rows.
- `POST subscriptions/:id/cancel` answers 409 when the subscription is no longer open. The route
  takes an id, thus a person can address a canceled row here. The self-service cancel cannot get
  such a row. Without the 409, a repeat asks the provider again, emits the cancel event again, and
  writes a second audit entry.
- `POST invoices/:id/refund`. The system tracks the refunds cumulatively in `refunded_minor`, and
  the sum cannot be more than `amount_minor`. When the cumulative refunds reach the total, the
  invoice becomes `refunded`. That flip revokes the `CustomerGrant` of a one-time sku, drops the
  cached entitlements of the buyer, and takes the units of a credit pack back. The balance can become
  negative, which blocks usage until the customer adds credits. A refund that leaves a remaining
  balance keeps the grant and the credits.
- `POST usage` is the internal metering ingest. It is idempotent on
  `(customer_id, idempotency_key)`. The server validates the meter against the plan catalog. There is
  no public meter endpoint.

**Services.** `PlanService` supplies `findActive()`.

`BillingUserService` does this work:

- It gets or makes the customer. The geography comes from the registration locale.
- It does the checkout and the cancel.
- It makes the usage summary, with `UsageRating` over the current period.
- It reads and sets the region, with the guard against a cross-provider migration.
- It lists the one-time catalog (`listProducts`) and does a purchase. The purchase calls
  `resolveProvider` and then `createOneTimePayment`. The product id travels through the custom data
  of the provider. The service answers `{ provider, url|null, sessionRef }` to the client.
- It starts a payment-method update. The dispatch uses the provider of the subscription, as the
  cancel does. It returns the hosted session, and the return URL is the billing settings page.
- It does the plan change and the proration preview. The next paragraphs describe that flow.

**The plan change.** An optimistic `version` compare-and-swap on the subscription serializes the
change before any money moves. A concurrent change loses the CAS and gets a 409. Thus the system
never asks the provider for a second conflicting charge. The CAS stays outside the DB transaction,
thus no row lock is held across the HTTP call to the provider.

Paddle delegates the change. The new plan key goes into the custom data again.

YooKassa records the charge leg as a `pending` invoice BEFORE the call to the provider. A plan change
is user-driven and runs one time, thus no later scan reconciles it, unlike a renewal. Without the
early record, a capture that the request then loses is recorded nowhere. The true payment reference
of the provider goes into its own committed write the moment that the call returns.

The service charges the prorated new plan FIRST. A declined card stops the change and flips that row
to `failed`, which is the one charge failure with a known result. Each other rejection leaves the row
`pending`, because the deadline bounds our call and not the request of the provider.

Then the service refunds the remainder of the outgoing plan. The refund goes against the invoice that
paid for the current coverage of that plan.

The service reserves that leg on the source invoice under a `FOR UPDATE` lock. The reservation
happens BEFORE the refund call to the provider and AFTER the charge, thus a declined card leaves no
reservation.

The lookup for the source invoice excludes the charge leg of the switch BY INVOICE ID.
`provider_event_id` is nullable, thus a `!=` on that key drops each row that has none. Thus a switch
can never refund the payment that it just took.

The cap of the unrefunded remainder applies inside that reservation. Thus an administrator refund of
the same invoice that lands during the flow makes this leg smaller, and this leg does not overwrite
it. A failed refund at the provider releases the reservation.

The closing transaction settles the charge leg to `paid` under a status guard. The confirming webhook
runs the identical flip, thus exactly one of the two emits `InvoicePaidEvent`. The same transaction
inserts the refund leg and applies the plan. Thus there is no window in which the customer is charged
and the plan is not applied. Each leg has its own unique `change-charge` or `change-refund` event id.

A switch during a trial moves no money. The route is guarded to the `active` and `trialing` statuses.
It refuses a subscription with a scheduled cancel. It requires a price for the same provider.

**`BillingAdminService`** does the cross-customer read, the cancel and the refund.

The administrator cancel differs from the self-service cancel in two ways only: how it finds the row,
and how it names the owner. The two run the same `cancelOpenSubscription` tail. That tail refuses a
row that is not open, asks the provider, and writes the cancel columns under a status predicate. It
answers 409 when the predicate matches nothing. Thus a cancel that lands during the provider round
trip loses, and it does not overwrite the row.

The refund runs as three steps in two short transactions: reserve, call, settle. Thus no row lock and
no pool connection is held across the HTTP call to the provider.

The first transaction commits the amount of the leg onto `refunded_minor` under a `FOR UPDATE` lock.
Thus a concurrent leg prices against the reservation and gets a 400 before any money moves.

Then the service calls the provider outside any transaction. The idempotency key is
`refund-{id}-{cumulativeAfter}`, that is the cumulative total after the leg. A failure releases the
reservation in a compensating transaction. The retry computes the same key, and the key scans of the
providers collapse it into the original money move.

The settling transaction does the one-way flip from paid to refunded only. It gates on the OWN
cumulative value of the settling leg. Thus a concurrent in-flight reservation cannot revoke a grant
for money that can still fail to move. This keeps the grant revocation and the credit clawback
exactly-once.

A full refund of a credit pack calls the `CreditService` clawback.

A crash between a successful provider call and the settle leaves the status `paid` with
`refunded_minor` at the full amount. That is the signature to reconcile on.

The reserve and release primitives are in `utils/refund-reservation.util.ts`. The self-service
proration leg shares them. `lockInvoice` is the single site that takes the `FOR UPDATE` lock on an
invoice. `remainingRefundable` is the single expression of the bound
`0 <= refunded_minor <= amount_minor`. `releaseRefund` is the single compensating release, with its
clamp at zero. The policy stays at the call site: the proration caps silently, and this route rejects
with a 400.

**`UsageService`** does the idempotent metering ingest.

`record()` normalizes `occurredAt` from an ISO string or a Date. It resolves the newest active
subscription, in the same order as the entitlement resolver. Thus the system bills the usage against
the subscription whose entitlements are in force.

The method deduplicates on the per-customer unique pair `(customer_id, idempotency_key)`. It also has
a guard for a unique-violation race. A key that another customer reuses is a distinct event and not a
replay.

A record is an observation, thus the current plan of the customer does not gate the write. The
service refuses only a meter that no plan in the catalog declares, with a 400. Such a meter is a typo
of the producer and can never become chargeable.

The service stores a meter that another plan prices. It counts that record on
`billing_usage_records_unrated_total{meter}` and leaves it for the rating step to ignore.

The response carries `pricedByCurrentPlan`. Thus the operator who uses an incorrect key learns at the
call site. That field is a verdict about the plan in force. The service resolves it again on an
idempotent replay and does not store it.

The method answers 409 while the credit balance is negative.

**`CreditService`** is the single owner of the prepaid balance. Each change is an atomic upsert of
`balance += delta`, and not a read, modify and write sequence. Each change also appends a
`CreditLedger` entry with the reason `purchase`, `usage` or `refund`. Each mutator joins the invoice
transaction of the caller. Thus the exactly-once property rides on the winning `provider_event_id`
insert.

**`UsageInvoicingService`** invoices a closed usage period of a provider-managed (Paddle)
subscription. The billing is postpaid.

The service reads and rates the prepaid credit balance under a `FOR UPDATE` row lock. Thus two
concurrent closes for the same customer serialize, and they never apply the credits two times.

It plants a pending Invoice, keyed by the unique value `usage:{subscriptionId}:{periodEnd}`, BEFORE
it posts the charge to the provider. It spends the applied credits in the same transaction. Thus a
close that races or replays loses the insert, and it never charges twice or spends twice.

A net charge of zero settles as a paid zero invoice with no call to the provider. That occurs when
there is no usage, or when the credits cover all of it.

**Entities.** The module has 11 entities: `Plan`, `Customer`, `CustomerGrant`, `CreditBalance`,
`CreditLedger`, `PaymentMethod`, `Product`, `Subscription`, `Invoice`, `UsageRecord` and
`WebhookEvent`. Each one has an entity-contract file and serialization specs.

**DTOs.** The response DTOs cover the subscription, the invoice, the payment method, the checkout
session, the region, the usage, the usage summary, the proration preview, the product, the customer
grant, the credit balance, the entitlements and the purchase session. Each one has the `WireType` and
`StructuralDiff` contract checks.

The request DTOs cover the checkout, the change, the cancel, the region, the refund, the usage record
and the purchase.

**Events (`events/billing.events.ts`).** The events are `SubscriptionActivated`,
`SubscriptionRenewed`, `SubscriptionPastDue`, `SubscriptionCanceled`, `PlanChanged`, `InvoicePaid`
and `PaymentFailed`. Each one carries a `userId`. `UsagePeriodClosed` comes from a provider-managed
usage rollover or from a cancellation, and the usage-invoicing listener reads it.

**Listeners.** `entitlement-changed.listener` reacts to each event that changes an entitlement. It
invalidates the cached entitlements of that user, and THEN it pushes `entitlements_updated` to them.
The order is important: a read against a value that is still cached re-caches the stale set.

`billing-user-deleted.listener` reacts to `UserDeletedEvent`. It cancels a provider-managed
subscription at the provider. It cancels a self-managed subscription locally and emits
`SubscriptionCanceledEvent`. It is best-effort.

**Providers.** The directory holds the `PaymentProvider` interface and the `NormalizedEvent` type
behind the `BILLING_PROVIDERS` token.

`verifyAndParseWebhook` has three results. A `NormalizedEvent` object is a delivery to reduce.
`WEBHOOK_IGNORED` is an authentic delivery that carries nothing to reduce, and the server
acknowledges it with a 200 and writes no ledger row. `null` is a payload that the server cannot
verify, and the answer is a 400.

`PaddleProvider` is the true Paddle client:

- `verifyAndParseWebhook` uses `webhooks.unmarshal` for the HMAC verification, and it makes a
  `NormalizedEvent` object. The event includes the usage charge key, which travels through the price
  custom data.
- `startCheckout` opens a hosted checkout.
- `chargeUsage` calls `createOneTimeCharge` at the cycle boundary.
- `createOneTimePayment` calls `transactions.create`. It uses the catalog `paddlePriceId`, or an
  inline non-catalog price for a custom amount. The one-time marker and the `productId` go into the
  custom data. The `url` value is optional, because Paddle.js can complete the payment with the
  transaction id.
- `changePlan` and `previewChangePlan` call `subscriptions.update` and `previewUpdate` with
  `prorated_immediately`.
- `updatePaymentMethod` calls `getPaymentMethodChangeTransaction` for the hosted checkout. The
  provider ignores the zero-amount completed and failed webhooks of that flow by their origin. It
  acknowledges them and does not reject them.
- `cancel` cancels the subscription.
- `refund` makes an adjustment. The Paddle API has no idempotency key from the client. Thus the
  refund key of the caller goes into the reason of the adjustment. A retry finds the existing
  adjustment through `adjustments.list` and does nothing. Thus there is no double refund.

`YooKassaProvider` is the true YooKassa client, and it is self-managed:

- `startCheckout` calls `createPayment` with `save_payment_method` and a redirect. A trial uses a
  zero-amount binding.
- `chargeOffSession` charges with the saved `PaymentMethod` token. It attaches the 54-FZ receipt and
  an `Idempotence-Key`. It reports `captured` only for a `succeeded` payment. It reports a
  payment-after-receipt in the `pending` or `waiting_for_capture` state as uncaptured, thus the core
  records the invoice as pending and does not give the period. A `canceled` payment throws an error.
- `findOffSessionCharge` scans the metadata of `getPaymentList`. It reports the same captured and
  pending statuses. This is the fallback path: `getPaymentList` cannot filter by customer, by payment
  id or by metadata, thus the scan walks the whole shop. The scan is page-bounded. The core reaches
  it only when a charge threw an error and no confirming webhook arrived after it.
- `getOffSessionCharge` calls `getPayment` directly with the recorded payment reference. It reports
  the same statuses. The core uses it wherever it already stored that reference. The method asserts
  that the payment carries the expected `chargeKey`. It fails loudly on a mismatch, and it does not
  report that there is no charge.
- `createOneTimePayment` calls `createPayment` with a receipt and a redirect. The metadata carries
  `purpose:one_time`. The provider does NOT save the card.
- `updatePaymentMethod` does a zero-amount re-bind with `purpose:method_update`. The success webhook
  becomes `payment_method.updated`. The provider ignores an abandoned re-bind.
- `refund` sends a refund receipt and an `Idempotence-Key`. The header deduplicates only inside the
  key store of YooKassa, which lives approximately 24 h. Thus the refund key of the caller also
  travels in the refund description. A replay finds it: it scans `getRefundList` for a match that is
  not canceled before it makes a refund. The scan is page-bounded and fails loudly when the result is
  not conclusive. It never refunds again on a guess.
- `verifyAndParseWebhook` reads the object again with a GET by id, and then makes a
  `NormalizedEvent` object.
- `cancel` does nothing.

`paddle.client.ts` and `yookassa.client.ts` build each SDK from the environment. Each one returns
null when the provider is not configured.

**Rating.** The directory holds the `RatingStrategy` interface, `FixedRating`, `UsageRating` and
`ProrationCalculator`.

`FixedRating` uses the plan price.

`UsageRating` sums the `UsageRecord` rows that carry the `meter_key` of the plan, with `occurred_at`
inside the period. A foreign meter belongs to another product, thus the rating never prices it at the
rate of this plan. A plan with no `meter_key` rates to zero. The strategy charges the overage above
`includedUnits` at `unitPriceMinor`.

`summarizeForPeriod()` supports `GET /billing/usage`. `summarizeForPeriodWithCredits()` supports the
usage invoicing of the two providers. The prepaid credits offset the billable units one for one
before the pricing step, and the caller deducts the applied units.

`ProrationCalculator` computes the split of a self-managed plan change. It uses a whole-day
remainder. It refunds the old plan and charges the new plan, as in section 17.4 of the billing
design.

**Renewals.** `RenewalService` is the renewal loop of the self-managed (YooKassa) provider. Section 8
of the billing design describes it.

The scan covers the subscriptions of the two rating modes. It skips a subscription whose owning user
is soft-deleted, and it joins `billing_customers` to `users` for that check.

A fixed plan prepays the next period. A usage plan postpays the period that closes. The rating covers
`[currentPeriodStart, anchor)` and applies the prepaid credits first. The invoice covers that period.

A net charge of zero advances the period with a zero invoice and no call to the provider. The service
decides this only after two steps: it inspects the invoice that the period already recorded, and it
polls any charge that is still open at the provider. Thus a period that rates to zero again during
the flow settles from what the system charged, and never from the new rating. The service spends the
applied credits inside the period-advance transaction.

The off-session charge uses an `Idempotence-Key` that is stable for each pair of subscription and
period. Its form is `renewal:{subId}:{anchorMs}`, and it is also the unique `provider_event_id` of
the renewal invoice. Thus a dunning retry reconciles the previous attempt instead of making a second
charge.

A charge that throws an error also records that invoice, as `failed` with an empty payment reference.
The deadline rejects the call of the core and does not cancel the socket, thus the provider can hold
a payment that the core never saw. The confirming webhook writes the payment reference onto that row,
and the dunning retry then reads that one payment with `getOffSessionCharge`.

A charge that the provider accepts but does not capture (`pending`) becomes a pending invoice with NO
period advance. The confirming webhook or the poll of the next scan resolves it. A captured payment
settles the invoice and advances the period. A payment that cancels at capture becomes `failed`, and
dunning starts.

That poll reads the single payment that the pending invoice recorded, with `getOffSessionCharge`. It
falls back to the shop-wide scan only for a row with no stored reference.

The advance is a compare-and-swap on the period end AND on the chargeable status. The statuses are
`trialing`, `active` and `past_due`, read at the start of the scan. Thus the advance runs exactly one
time. Thus a cancel that lands during the provider round trip does not go back to active. The paid
invoice stays recorded and refundable, and the service logs the blocked advance at warn level.

`cancel_at_period_end` is intentionally outside the predicate, thus the period that the customer paid
for still opens.

A **usage** subscription with `cancel_at_period_end` that reaches its boundary rates and charges the
metered period that it closes. It uses the same renewal key. The invoice and the cancel CAS commit in
one transaction, and the period does NOT advance.

`billClosingUsagePeriod()` does the same for an immediate cancel, over `[currentPeriodStart, now)`,
under the key `cancel:{subId}:{periodStartMs}`. Neither path walks dunning. Thus a decline books the
period as `failed` and the cancellation still completes.

The service advances the period and converts a trial. The new boundary is
`nextPeriodEnd(billing_anchor_at, boundary, interval)`. That helper steps one interval and restores
the day of the month of the anchor. Thus a short month clamps one time, and the billing day does not
move backwards permanently. The invoice period of a fixed plan uses the same helper, and a trial
anchors again to `trial_end`.

The service walks dunning: 3 attempts across a grace window of approximately 7 days, then `past_due`,
then `canceled`. The customer keeps the entitlements through the grace window.

The dunning write is itself a compare-and-swap. It compares the rung and the chargeable status that
the scan claimed at its start. The period-end cancel compares the status and the cancel flag. Each
one emits an event only when it wins. Thus two overlapping scans that react to one decline walk a
single rung, cancel one time, and notify the customer one time.

One scan takes a maximum of `RENEWAL_SCAN_MAX_PER_RUN` (200) due rows, with the oldest boundary
first. Thus a backlog drains across successive scans, and not in one unbounded sequential pass. The
service logs the ceiling at warn level. A deferred row is safe by construction: the worker reads it
again, the charge key is per period, and the advance is a CAS.

`RenewalProcessor` is the BullMQ repeatable scan. The module upserts it at bootstrap, thus it is safe
with more than one instance.

**Webhooks.** The `@Public()` routes are `POST webhooks/paddle` and `POST webhooks/yookassa`. They
take a `RawBodyRequest` object.

`WebhookIngestionService` verifies the delivery through the provider seam. A delivery that it cannot
verify gets a 400. An authentic delivery with nothing to reduce gets a 200 and no ledger row.

The service does an idempotent insert on the unique pair `(provider, provider_event_id)`. It persists
the verified `NormalizedEvent` object on the row. Then it enqueues the reduction on BullMQ. Without
Redis it reduces inline.

The deduplication is status-aware. A delivery becomes a permanent no-op only when it reaches
`processed`. A row that is still `received` comes from a reduce that threw an error, or from a worker
that stopped. The service processes such a row again at the next redelivery, and it does not drop it.

A periodic `WebhookReconciliationService` sweep replays each row that stays `received` past a
threshold, from the persisted event. That recovery is provider-independent, thus it covers the queued
path.

A daily `WebhookRetentionService` sweep bounds the ledger. A `processed` row loses its `payload`
after `BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS`, and the row goes after
`BILLING_WEBHOOK_RETENTION_DAYS`. The sweep measures the two ages from `received_at`. It never prunes
a `received` row or a `dead_letter` row, because a person can still replay the two. The work is
batched and capped for each sweep. Thus a ledger that nobody pruned before is worked off across
several days, and not in one long transaction.

`BillingEventReducer` applies the `NormalizedEvent` object onto a `Subscription` or an `Invoice`
inside a transaction, and it is idempotent. It stamps the row with `event.provider` and with the
lifecycle owner that follows from it: Paddle is `provider`, and YooKassa is `self`. Then it emits the
matching domain event.

On the self-managed first-payment path it also persists the saved card as the default
`PaymentMethod` of the customer. It points the incomplete subscription, found by customer id, at that
method. Then it flips the subscription to `active` or `trialing`.

A `payment_method.updated` event comes from a method-update re-bind. It changes the default card. The
old method is demoted and kept for the history. The autopay pointer of the customer and the open
subscription move to the new row. There is no invoice and no status change.

For a provider-managed usage subscription, the reducer detects the period rollover. The incoming
snapshot starts at or after the stored boundary. It emits `UsagePeriodClosed` after the commit.

A `subscription.canceled` event closes the open metered period in the same way. The boundary comes
from the STORED row, and not from the notification or from the wall clock. Thus a replayed delivery
keys the same invoice instead of a second charge, and a true rollover for that boundary does nothing.

A paid or failed webhook that carries the usage charge key settles or fails the matching pending
usage invoice. It does not insert a new row.

A webhook that carries an off-session charge key never inserts a row, because the core already
recorded that invoice:

- A succeeded event settles a row that is still pending. The flip from `pending` to `paid` is status
  gated, and it writes `paid_at` and the reference. It spends the credit units that the rating used.
  Then it emits `InvoicePaid`.
- If the row is already settled, the event reconciles the reference only.
- If the key matches no pending row, the reducer reports it at error level on
  `billing_off_session_charges_unmatched_total{provider}`. It reports only the flows that record
  before the charge, that is `change-charge:`, as `utils/charge-keys.util.ts` says. The `renewal:` and
  `cancel:` charges record after the provider answers, thus a webhook that wins that race matches
  nothing frequently. The report is never a throw. A throw leaves the delivery `received`, and the
  reconciliation sweep then replays it forever.
- A canceled event comes from a pending charge that the provider declined at capture. The reducer
  flips the pending row to failed silently. The renewal scan sees that and owns the dunning ladder.

A paid one-time purchase carries `kind one_time` and the `productId`, through the custom data or the
metadata. The reducer applies it onto an invoice with `kind 'one_time'`, `subscription_id NULL` and
the `product_id` value. It applies the effect of the product one time for each paid invoice. An `sku`
makes a `CustomerGrant` row, with the expiry from `grant.durationDays`, or permanent with no such
value. A `credits` product adds to the prepaid balance and writes a ledger entry. A `custom` product
gives no grant.

The reducer never links or activates a subscription for a one-time purchase, and it saves no card.
The seam ignores a failed or canceled one-time payment, because nothing is pending locally and there
is no dunning signal.

**Configuration.** `BillingConfigService` supplies the `paddle` and `yookassa` configured booleans,
which come from the environment.

**Registrars.** `BillingConfiguredAttributesRegistrar` registers the `paddleConfigured`,
`yookassaConfigured` and combined `billingConfigured` feature-flag attributes. The public `billing`
flag gates the UI on the configuration. The per-provider `billing.provider.*.enabled` administrator
kill switches gate the geo-router.

#### entitlements

`EntitlementsModule` is a PEER of auth and of billing. It is not a subdirectory of either one,
because the two import it.

`entitlements.module.ts` imports only
`TypeOrmModule.forFeature([Customer, CustomerGrant, Plan, Subscription])`. It has no edge to auth.
Thus `AuthModule -> EntitlementsModule` and `BillingModule -> EntitlementsModule` are both one-way,
and the existing `BillingModule -> AuthModule` edge stays acyclic. There is no `forwardRef`.

`BillingModule` re-exports the module. Thus a consumer that imports `BillingModule` continues to
resolve the service and the guard with no change.

The module reads four row types from `billing/entities/`. That is a schema dependency and not a
behavioral one.

`entitlement.service.ts` supplies `capabilitiesFor(userId)`. A subscription with the status active,
trialing or past_due in the grace window gives `plan.entitlements`. Each other condition gives the
Free entitlements. The result is the union with the active `CustomerGrant` rows, that is the grants
that are not revoked and not expired, from a paid one-time sku purchase.

The per-user cache is keyed by the shared `CacheVersionCounter` value
(`common/utils/cache-version-counter.ts`). That counter uses an atomic Redis `INCR`. Without Redis it
falls back to an in-memory read, modify and write sequence.

`limitFor(userId, key)` reads the resolved limits from that same cache. A `null` result means that
the plan carries no limit under that key, and the caller then applies its own default.

`entitlement.guard.ts` holds `EntitlementGuard`, which answers 403.
`require-entitlement.decorator.ts` holds `@RequireEntitlement('<cap>')`.

`entitlement.constants.ts` holds `ENTITLEMENT_KEY`. It lives here and not in the decorator, thus the
guard and the decorator do not import each other. Refer to the barrel and cycle rules in the root
README.

`entitlement.types.ts` holds the `EntitlementCapability` union and `ResolvedEntitlements`. The shared
`EntitlementLimits` map types the limits.

`EntitlementChangedListener` is NOT here. It stays in `billing/listeners/`, because it binds events
that billing owns and pushes through `NotificationsService`.

#### users

`controllers/` holds `UsersController`. It has the CRUD operations and the search. Each endpoint uses
`@Authorize([action, 'User'])`.

`services/` holds `UsersService`.

`entities/` holds the `User` entity, with a ManyToMany relation to `Role` through `user_roles`.

`dto/` holds `CreateUserDto`, `UpdateUserDto` and `UserResponseDto`. `UserResponseDto` is the public
form, and its `roles` field is a `RoleResponse[]` array. `AdminUserResponseDto` extends
`UserResponseDto`. It adds `lockedUntil`, and its `roles` field is a `RoleAdminResponseDto[]` array.

### Request Pipeline

```
Request -> Global Middleware (Compression, CookieParser, CORS)
        -> Module Middleware
        -> Guards (JwtAuthGuard, RolesGuard)
        -> Interceptors (ClassSerializer with @SerializeOptions, custom)
        -> Pipes (ValidationPipe, custom)
        -> Controller Handler
        -> Interceptors (response phase)
        -> Response
```

On an exception, `GlobalExceptionFilter` catches each error. It returns a standard error response
with a timestamp, the path and a message for the user. It maps a TypeORM error by its PG error code.
An unknown error becomes a generic 500.

### Authentication

**LocalStrategy** validates the email address and the password with bcrypt at a login.

`POST /auth/login` has no `@Body()` DTO. A guard runs before a pipe, thus a DTO never executes there.
For that reason the strategy is the single place that canonicalizes the raw credentials. The address
goes through the shared `normalizeEmail` function (`shared/src/utils/email.ts`). A credential that is
not a string becomes an empty string. Thus a login answers 401 and never 400.

**Email canonicalization.** `normalizeEmail` trims the address and makes it lowercase. The DTO
`@Transform` decorators apply it. `LocalStrategy` applies it. The three OAuth strategies apply it. It
also runs once more inside `loginWithOAuth`, which is the only writer of a user that OAuth makes. The
`UQ_users_email_lower` index in the schema is the backstop.

**JwtStrategy** verifies the signature of the Bearer token. It pins the issuer, the audience and the
signing algorithm. It requires the `access` token purpose and a `sub` claim that is not empty. It
applies the `JWT_MIN_IAT` cutoff and the per-user `tokenRevokedAt` cutoff. It then requires a `sid`
claim and asks `RefreshTokenService.hasLiveSession`, which looks for a row of that session which is
not revoked and not expired, so a sign-out on one device refuses that device on its next request
while the other devices continue. It returns `PayloadFromJwt`, that is `{ userId, email, roles }`.
There is no `isAdmin` flag.

**Sessions.** A sign-in mints a session id in `SessionIssuerService`. The access token carries it as
`sid` and the refresh row stores it as `session_id`. Rotation revokes one row and inserts the next
under the **same** session id, so a refresh in one tab does not strand the access token another tab
of the same device holds. `AuthService.logoutSession` deletes every row of one session, which is what
`POST /auth/logout` calls. `AuthService.logout` deletes every row of the account and stamps
`tokenRevokedAt`; it belongs to the password change and to the other account-wide paths.

**Token purpose.** The service signs three token types: access, OAuth link and OAuth data. The three
use the same key. Thus each token carries an explicit `purpose` claim, and each consumer accepts only
its own purpose.

Without that claim, a token from one flow authenticates on another flow. An OAuth-data token carries
no `sub` claim, and a user lookup with no id then resolves to an arbitrary row instead of a failure.

One factory (`jwt-module-options.factory.ts`) pins the issuer and the audience for the signing and
for the verification. Thus the two cannot diverge.

**GoogleStrategy, FacebookStrategy and VkStrategy** do the OAuth2 login. The module registers each
one only when its environment variables have a value.

**Routing is secure by default.** `CoreModule` registers `JwtAuthGuard` globally through `APP_GUARD`.
Each endpoint requires a valid Bearer token, and `@Public()` on a handler or on a controller is the
only exception. Thus a new endpoint is protected when a person forgets to mark it. The
`check-auth-coverage` e2e suite reads the per-feature route manifests in `contracts/routes/` and
enforces this.

**The `@Public()` decorator** marks an endpoint that a caller can reach with no authentication. The
routes are the login, the register, the password reset, the OAuth init and callback, the health check
and `/metrics`.

**The `@OptionalAuth()` decorator** is a variant of `@Public()`. It still calls
`JwtStrategy.validate()` when the request has a Bearer token, thus the handler gets a populated
`req.user` object. It never rejects a request with a missing, invalid, expired or revoked token.

`GET /feature-flags` uses it. Thus one endpoint serves an anonymous browser, with the public flags
only, and an authenticated user, with the full evaluation of the role, userId and email attribute
rules.

Do not put `@OptionalAuth()` and `@Public()` on the same handler. If a person sets the two, `@Public()`
wins and the strategy does not run.

**PermissionsGuard** resolves the permissions of the user and caches them for 5 minutes. It checks
the permissions that the typed `@RequirePermissions([Actions, Subjects])` decorator names. A role
with the `isSuper` flag bypasses each check.

**The `@Authorize([action, subject])` decorator** is a composite. It applies `JwtAuthGuard`,
`PermissionsGuard` and the typed `@RequirePermissions()` decorator. It replaces the
`@UseGuards(JwtAuthGuard, RolesGuard) @Roles()` pattern.

The two decorators take a tuple that is not empty
(`[PermissionCheck, ...PermissionCheck[]]`). Thus `@Authorize()` is a compile error. An empty check
list makes `PermissionsGuard` return `true`. Also, the guard reads the metadata with
`getAllAndOverride`, thus an empty call on a handler cancels an `@Authorize(...)` call on the class.

`@RequirePermissions` is marked `@internal`. On its own it attaches the metadata and does not apply
the guard. Thus it looks protective and enforces nothing.

**CaslAbilityFactory** builds an `AppAbility` object from the roles and the permissions of the user.
`AuthController` uses it to return the packed CASL rules from `GET /permissions`, through
`packRules()`.

The factory puts the allow rules first and the deny rules last. Thus a permission with
`conditions.effect === 'deny'` becomes a CASL `cannot()` rule. Such a rule reliably overrides an
earlier allow for the same pair of resource and action.

The conditions are fail-closed. When `resolveConditions()` vetoes a permission, an `allow` registers
nothing and a `deny` registers as an unconditional `cannot()`.

These inputs cause a veto:

- A malformed branch shape, per the shared finders in `permission-condition-shape.ts`. That covers a
  `fieldMatch` value that is not an array or that is an empty array, a `userAttr` attribute that is
  not a string, an invalid `ownership.userField`, and a prototype-pollution key.
- An unknown `userAttr` attribute.
- Invalid or non-object `custom` JSON.
- A `custom` object with a `$`-key outside `ALLOWED_MONGO_OPERATORS`.
- A `custom` `$in` or `$nin` whose value is not an array of JSON scalars.
- A `fieldMatch`, `userAttr` or `custom` key that collides with the protected `ownership.userField`
  key. Such a key replaces the owner-scoping predicate with a broader one.
- A restriction branch that resolves to an empty query.

The runtime check runs the same `validateMongoQueryKeys()` allow-list that the DTO applies on a
write. Thus CASL cannot honor a stored condition that the SQL list-filter translator drops.

The factory never registers a partial resolution. A drop of the malformed fragment alone widens the
authored restriction silently. Only a condition with no branch, that is a bare `effect`, registers
unconditionally.

`PermissionConditionDto` enforces the same shape rules at the input, through the custom validators in
`common/validators/permission-condition-shape.validator.ts`. Thus the server rejects a partly
malformed condition with a 400 at authoring time.

**Instance-level enforcement.** Each single-entity endpoint loads the target record and runs
`assertCan(ability, action, subject(<Subject>, entity))` BEFORE it returns or changes the record.
Those endpoints are `GET/PATCH/DELETE /users/:id`, `GET /users/:id/permissions`,
`GET/PATCH/DELETE /roles/:id`, `GET /roles/:id/permissions`, `PATCH /rbac/resources/:id`,
`POST /rbac/resources/:id/restore`, and `PATCH/DELETE /rbac/actions/:id`.

`POST /users` runs the same check against the record that it makes. The subject comes from
`CreateUserDto`, minus `password`, which no authorization condition can legitimately test. Thus the
server enforces a `create` grant with a `fieldMatch` or `custom` condition, and that grant does not
collapse to the type-level check.

This blocks the type-level `@Authorize` bypass. Without it, a conditional grant that an administrator
configured becomes unconditional on a single-entity route.

`UsersService.update`, `UsersService.remove`, `UsersService.restore`,
`RoleService.assignRoleToUser`, `RoleService.removeRoleFromUser` and the mutations of the permission
set of a role apply the same check in the service layer. The permission-set mutations are
`PUT /roles/:id/permissions`, `POST /roles/:id/permissions` and
`DELETE /roles/:id/permissions/:permId`. `RoleService` checks them before the system-role lock and
before the grant check.

The server blocks the assignment and the removal of a super role for an actor that is not a super.

Each denial writes a `PERMISSION_CHECK_FAILURE` audit row. The row has `details.instanceCheck === true`
and `actorId` set to the refused caller. Each service method that takes an `ability` parameter also
takes the actor for this purpose. Each denial also increases
`rbac_permission_denied_total{level="instance"}`.

**A delegated grant can narrow the condition of the caller, and never widen it.**
`assertCanGrantPermissions` requires the caller to hold the granted pair of action and subject. When
each matching allow rule of the caller is conditional, the granted condition must **contain** one of
them.

A grant qualifies in three conditions. It is equal. It adds predicates. Or it narrows the value set
of an existing predicate, for example `[true]` under a caller that holds `[true, false]`, or a scalar
that the `$in` of the caller admits.

Anything that the check cannot *prove* narrower gets a 403 with
`errors.roles.conditionBroaderThanCaller`. That covers a changed value, a dropped predicate, and a
shape that the check does not decide, such as a tighter `$gt` range.

A request that omits the conditions gets a 403 with `errors.roles.cannotGrantPermission`. A condition
that the resolver vetoes gets a 403 with `errors.roles.conditionUnresolvable`, because it restricts
nothing at run time.

The check compares the two sides as resolved MongoQuery objects. It runs the request body through the
same `resolveConditions` function that the ability factory uses, with the id of the caller. Thus it
compares two resolved queries and not two authored shapes.

A super role bypasses the check. `DELETE /roles/:id/permissions/:permId` has no grant check, because
a removal is a de-escalation. The server does not validate a grant that a person wrote before this
rule again.

**The server rejects an unsatisfiable grant on a write.** `ownership` and `userAttr` resolve to the
id of the acting user. A record that does not exist yet can never carry that id. Thus either branch
on a `create` permission denies each create instead of a restriction.

`RoleService.assertConditionsApplicable` rejects such a grant with a 400
(`errors.roles.conditionNotApplicable`) on `PUT /roles/:id/permissions` and
`POST /roles/:id/permissions`, for each caller and for a super role. The check is a validity rule and
not an authorization rule, thus it runs before the can-grant check that a super role bypasses.

The method resolves only the items that carry one of those branches. Thus the common case adds no
query.

**JWT payload.** `CustomJwtPayload` carries `email` and an optional `roles: string[]` field, above
the standard `JwtPayload` claims. An access decision goes through CASL and RBAC, and never through
the payload.

**Field-level response gating.** The `class-transformer` decorators on an entity control the wire
shape.

`@Exclude()` always hides a field, for example `User.password` and `User.failedLoginAttempts`.

`@Expose({ groups: ['privileged'] })` hides a field by default. The field appears only on a
controller with `@SerializeOptions({ groups: ['privileged'] })`. Examples are `User.lockedUntil`,
`Role.isSystem` and `Role.isSuper`.

`@Authorize` decides who can call the endpoint. The serialization decides which fields the authorized
caller sees.

The self and auth endpoints, that is `AuthController` and `OAuthController`, carry no group. Thus
they give the public form. The administrator endpoints, that is `UsersController` and
`RolesController`, carry the `privileged` group. Thus they give the administrator form.

This works on an entity instance only. A handler that spreads an entity into a plain object removes
the metadata that the interceptor reads. Thus a response must return the entity itself. A payload
that leaves the reach of the interceptor, such as the signed `oauth_data` cookie, must go through
`instanceToPlain` at the point where a person builds it.

**Refresh tokens.** A refresh token is an opaque hex string of 80 characters. The database keeps it
as a SHA-256 hash. The server delivers it as an `HttpOnly SameSite=Strict` cookie with the path
`/api/v1/auth`. The server rotates it at each use. It never appears in a response body.

The rotation revokes the presented row **conditionally**, with
`WHERE id = :id AND revoked = false`. That happens in the same transaction that inserts the
replacement.

The service treats `affected === 0` as the loser of a concurrent rotation. It answers 401 with
`errors.auth.invalidRefreshToken`. It writes a `TOKEN_REFRESH_FAILURE` audit row with
`reason: 'concurrent_rotation'`. The throw rolls the replacement back.

Without that condition, the two racers read the row as unrevoked under READ COMMITTED, and each one
committed a live successor.

The loser gets a plain 401 and not a session purge, because a benign double refresh from two tabs
must not log the user out everywhere.

**Reuse detection** follows the OAuth 2.0 BCP and RFC 6819. When `refreshTokens()` sees a token where
`revoked === true && !isExpired()`, the server deletes each refresh token of the user and stamps
`User.tokenRevokedAt`. That also invalidates the live access tokens. The server writes a
`TOKEN_REUSE_DETECTED` audit row and increases
`auth_events_total{event="token_reuse_detected"}`.

A token that is revoked and expired falls through to the standard 401. That is the natural cleanup
window.

**OAuth accounts.** The user manages the linked providers. An unlink has a safety check.

The check and the delete run in one transaction that holds a `FOR UPDATE` lock on the user row
(`OAuthAccountService.unlinkProvider`). Thus two concurrent unlink requests cannot both see "one
other provider remains". Without the lock, they leave an account with no password and no way to
authenticate. The loser gets a 400.

An unlink of a provider that is not linked returns 404 (`errors.auth.oauthProviderNotLinked`) and
writes no audit row.

**A credential change tells the owner.** An audit row is read by an operator during an investigation.
A message is read by the owner in minutes, and that is what turns a silent takeover into a reported
one. Five sites mail the account address: `AuthController.updateProfile` (self-service password
change), `UsersController.update` (administrator password change), `AuthService.resetPassword` (a
completed reset), `OAuthService.linkOAuthToUser` (a linked provider) and `OAuthController.unlinkOAuth`
(an unlinked provider). Each send is fire-and-forget with a logged `.catch`, thus a mail outage never
turns a password change into a 500.

The address always comes from the account row, never from the request. `unlinkProvider` returns the
address and the locale that it read under the row lock, and the controller sends after that
transaction commits. Thus a rejected unlink sends no message.

The notices carry no action link. The recipient can be the victim of the change, and a clickable
control in a message that reaches a mailbox of the attacker is a new credential-bearing surface. The
body names the change, the UTC time and the IP address, and it says to reset the password and to
review the connected accounts. OWASP ASVS 5.0 requirement 6.3.7 asks for this notification.

`mock-server/` prints the same three notices to stdout beside the audit calls that it already makes.
The mock has no link path to mirror, because both provider halves answer 501.

**Automatic linking is disabled.** When a local account already exists for the email address that
OAuth asserts, the callback throws `OAUTH_EMAIL_ALREADY_REGISTERED` (409). It redirects to
`/login?oauth_error=email_already_registered`. The user must log in with their password and then link
the provider with `POST /auth/oauth/link-init`.

A new user that OAuth makes takes the `email_verified` flag of the provider. Google gives
`profile.emails[0].verified`. Facebook gives `profile._json.verified`. VK always gives `false`.

**An OAuth callback failure redirects, and does not answer 401.** Passport rejects a callback inside
the guard. Three examples are a denied consent screen, a missing or expired state cookie, and a
failed code exchange. Thus the handler that redirects back to the client never runs.

`createOAuthProviderGuard` overrides `handleRequest`. It raises
`OAuthAuthenticationFailedException` instead of `UnauthorizedException`. The controller-scoped
`OAuthAuthenticationExceptionFilter` answers with `302 CLIENT_URL/login?oauth_error=auth_failed`. The
browser is in the middle of a navigation here, and it is not calling an API.

The guard selects the two halves of that redirect from a fixed set, and never from the request. The
query `?error=access_denied`, which is how each provider reports a declined consent screen, becomes
`oauth_error=oauth_cancelled`. The presence of the `oauth_link` cookie makes the target `/profile`
instead of `/login`. Thus a link attempt that started on the profile page ends there. The filter also
clears that cookie, because the attempt is over.

**The link intent belongs to one authorization flow.** `CookieStateStore.store` ties an unclaimed
intent to the one-time state it mints, and rewrites the cookie as `b:<state>:<token>`. The callback
takes the link branch only when that bound state equals the state the callback presents, compared
with the same timing-safe helper the store uses. An intent that a different flow claimed, and an
intent that no flow claimed, are both a plain sign-in. An intent that an earlier flow already claimed
is never rebound: handing it to the flow that runs now is the same defect in a new place. A
mismatched intent is left in place rather than cleared, because its own flow may still finish.

The marker and the separator are both `:`, which appears neither in a hex state nor in a JWT. The
intent is not carried inside the `oauth_state_<provider>` cookie, whose separators are `.` and `-`,
and a JWT holds both. The binding runs inside `store` and adds no parameter, because
`passport-oauth2` dispatches on `store.length` and `verify.length`.

**The link intent also ends with the session.** `POST /auth/logout` clears the `oauth_link` cookie,
and so does a self-service password change, which revokes the sessions for the same reason. The
refresh-token clear cannot do it, because a cookie has a path and the two cookies sit on different
paths: `/api/v1/auth` and `/api/v1/auth/oauth`. `linkOAuthToUser` also refuses a link token whose
`iat` is earlier than `User.tokenRevokedAt`, which is the comparison the JWT strategy makes. That leg
holds when the cookie reaches the callback from a different tab or a different device, and it fires
only on the paths that still write that column: a password change, a password reset, an administrator
action and the reuse detector. The per-device logout writes none, so there the cookie clear plus the
300 second expiry are the bound. A link token with no `iat` links nothing.

The two session legs do not fire when the session does not end, which is why the flow binding above
exists. Without all three, an abandoned link attempt attaches the next provider identity in that
browser to the account that started it.

A provider that nobody configured still returns 404. The validated `CLIENT_URL` value comes from one
provider (`auth/providers/client-url.provider.ts`), which the controller and the filter share.

**The OAuth state is scoped for each provider and for each flow in progress.** `CookieStateStore`
writes an `oauth_state_<provider>` cookie. The cookie is `httpOnly`, uses `sameSite: 'lax'` and the
path `/api/v1/auth/oauth`. Its value is a list of a maximum of 5 `<state>-<expiresAt>` entries.

Thus two flows can run together. Two providers use two different cookies, and two tabs of one
provider each hold their own entry.

A state is single-use, and a successful verify consumes it. Each entry expires 5 minutes after the
server issued it, and a later flow that refreshes the `maxAge` of the cookie does not change that.

A callback whose state matches nothing leaves the other entries as they are. Thus it cannot cancel a
flow that it does not own.

A flow that starts on a request with no response object fails there. It does not make a state that
nothing persisted.

**Token cleanup.** A daily cron job removes the expired tokens. A weekly cron job removes the tokens
that are revoked and expired.

**Account lockout.** 5 failed logins lock the account for 15 minutes, and the answer is HTTP 423 with
`lockedUntil`, `retryAfter` and the standard `Retry-After` header. The lock is tested after the
password comparison, thus a wrong password answers the generic 401 whatever the state of the account,
and a locked account collects no more strikes. A password reset clears the lock. The end of the
window clears it. An administrator can also unlock the account with a user update.

**Email verification.** It is necessary before a login. The token expires in 24 hours, and the user
can request the email again.

The server makes an OAuth user with `isEmailVerified=true` only when the provider asserts that the
address is verified. If not, the server sends a verification email at the signup, which is the flow
of a local registration. A later OAuth login does not change the flag, unless the provider vouches
for that same address.

An administrator email change through `PATCH /api/v1/users/:id` sets `isEmailVerified` to false. It
issues a new hashed token and sends a verification email. It also revokes each session of the target,
through `UserSessionRevocationRequiredEvent`, which the code awaits as it awaits an administrator
password change. A person moves an address to recover an account, thus the access token and the
refresh tokens of the previous holder must die with it. A resubmitted address that does not change
revokes nothing.

The server enforces the uniqueness of the address. A conflict answers HTTP 409 with
`errorKey: errors.users.emailExists`.

**Self-service email change.** The flow has two steps and confirms at the new address.

`POST /api/v1/auth/profile/email/initiate` stores a hashed token and the new address on the user row,
with an expiry of 1 hour. It sends a confirmation link to the new address. It also sends a masked
alert with no link to the old address.

`POST /api/v1/auth/profile/email/confirm` applies the change inside a transaction. It checks the
uniqueness again for the race window. It revokes each refresh token, and it notifies the old address.

The server rejects an account with OAuth only, because it has no password. Such a user must set a
password first.

The endpoint has a throttle of 3 calls each hour. It is enumeration-safe, because a conflict on a
taken address gives the same response shape.

The server clears the `pendingEmail*` fields that are in progress on a `resetPassword` call, on an
administrator email change, on a soft delete, and on `UserDeletedEvent`.

A partial unique index on `LOWER(pending_email)`, plus the dual-email checks in `register`,
`users.create` and `users.update`, keep the set of `{email}` and `{pendingEmail}` globally unique
under a concurrent write.

**Password reset.** The forgot-password and reset-password flow uses a token that expires in 30
minutes. The reset invalidates each session, clears the lockout, and sets `isEmailVerified = true`.
The server mails the token only to `user.email`. The same transaction clears the `pendingEmail*`
fields, thus a reset cannot confirm a change to another address that is in progress.

**CAPTCHA soft trigger.** `CaptchaRequiredGuard` gates `/register` and `/forgot-password` with a
Cloudflare Turnstile challenge. The challenge activates only when `X-RateLimit-Remaining` is 1 or
less for the IP of the caller.

The CAPTCHA is **disabled by default**, because the two environment variables are empty. To activate
it in production you need a free Cloudflare account. The full steps are in
[Enabling CAPTCHA in production](#enabling-captcha-in-production).

The test keys (`1x00000000000000000000AA` and `1x0000000000000000000000000000000AA`) operate for
local development and for CI. They are **public and give no protection in production**.

### Email (MailModule)

- The module uses `nodemailer`. It sends the verification message, the password reset message and the
  email-change messages.
- The module uses an **SMTP transport** when the `SMTP_HOST` variable has a value.

  It enforces STARTTLS on port 587 **when the credentials are configured**, through `requireTLS`.
  Thus a downgrade stops the delivery and does not leak the credentials.

  It uses implicit TLS on port 465, and also when `SMTP_SECURE=true`. It sets
  `minVersion: TLSv1.2` and keeps the certificate validation on.

  A local sink with no authentication is the exception. Mailpit is such a sink: it has no credentials
  and no STARTTLS. Thus plaintext delivery in development still operates.
- The module uses a **console transport** when `SMTP_HOST` has no value. It logs a URL that a person
  can click.
- An email link uses the `CLIENT_URL` variable. The two forms are
  `${clientUrl}/verify-email?token=xxx` and `${clientUrl}/reset-password?token=xxx`.
- **Delivery is asynchronous** when `REDIS_URL` has a value. The service renders the message and then
  puts it on the BullMQ queue `mail`. `MailProcessor` delivers it with 3 attempts and an exponential
  backoff.

  Without `REDIS_URL`, `MailService` delivers the message inline in the request, with no retry.

  The queue is transparent to a caller, because `MailService.sendXxx(...)` does not change.

  Mail is best-effort on the two paths. A failed enqueue, for example during a Redis outage, and a
  failed inline delivery are logged and never reach the caller.
- **Delivery test.** `test/email-delivery.e2e-spec.ts` starts the full app. It verifies the sequence
  of a register, an email, a verify and a login against a Mailpit sink. It reads the message through
  the REST API of Mailpit.

  CI runs a `mailpit` service with `SMTP_HOST` and `SMTP_PORT` set. The test is gated on `DB_HOST`
  **and** `SMTP_HOST`, from the environment or from `.env`. Thus it skips while no sink is
  configured, and it does not wait out the delivery timeout.

#### Transport options

| Mode | When | Config |
|------|------|--------|
| Console | `SMTP_HOST` is empty | None. The server logs the links to its console |
| Local Mailpit | To test a true send locally | `SMTP_HOST=localhost`, `SMTP_PORT=1025`, with no user and no password |
| Gmail SMTP | Production. It is free, with a limit of approximately 500 messages each day | `smtp.gmail.com:587` with an App Password |

**Local testing with Mailpit.** Capture the outgoing email in a local inbox, and send nothing
outside:

```sh
cd server
docker compose up -d mailpit   # or `docker compose up -d` for the whole dev stack
```

Set `SMTP_HOST=localhost` and `SMTP_PORT=1025` in `server/.env`. Leave `SMTP_USER` and `SMTP_PASS`
empty. Restart the dev server. Then start a flow, that is a register, a forgot-password or an email
change. Read the message at http://localhost:8025.

**Production with Gmail SMTP.** This needs no paid provider:

1. Enable 2-Step Verification on the Google account.
2. Make an **App Password**. Open the Google Account, then Security, then App passwords. The result
   is a token of 16 characters, and it is not the login password.
3. Put these values in the `server/.env` file of the deployment:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-account@gmail.com
   SMTP_PASS=<16-char app password>
   SMTP_FROM=your-account@gmail.com
   ```
4. Restart the server container, thus it reads `server/.env` again.

> Gmail rewrites the `From` header to the authenticated account. Thus `SMTP_FROM` **must** be equal
> to `SMTP_USER`. If not, a message looks spoofed and a filter removes it. The free sending limit of
> Gmail is approximately 500 recipients each day.

> **On a VPS that CI deploys:** the SMTP credentials are GitHub repository secrets, as each other
> production secret. `scripts/sync-prod-env.sh` writes them into the VPS file `server/.env` at each
> deploy. Thus the next deploy overwrites a manual edit of a secret-managed key. Refer to
> ["Production credentials and secrets"](../README.md#production-credentials-and-secrets) in the root
> README. That section has the full inventory, the caution about `DB_PASSWORD`, and the checklist to
> provision a VPS from nothing.

#### Localization

Each transactional email comes from a shared branded Handlebars layout
(`mail/email.template.ts`). The copy for each locale is in `mail/mail-content.ts`.

The server sends each message in the stored `users.locale` value of the recipient. The languages are
EN and RU, and the default is `en`. The registration captures the locale through an optional `locale`
field. A user can edit it from the client profile.

### Database

TypeORM migrations manage the core tables.

Each timestamp column that a keyset `sortBy` value can name is a `timestamptz(3)` column. The cursor
encodes the sort value with millisecond precision. Thus a column with more precision names a point
before the row that gave it, and pages then drop or repeat rows silently.
`test/instants-timestamptz.e2e-spec.ts` enforces this rule.

| Table | Description |
|-------|-------------|
| `users` | UUID PK. `email` is unique. The functional unique index `UQ_users_email_lower` on `lower(email)` stops two accounts that differ only by case. The row holds the name and the bcrypt password, which is nullable for a user with OAuth only. It holds `isActive`, `isEmailVerified` and `locale`, the email language, with the default `en`. It holds `failedLoginAttempts` and `lockedUntil`. It holds the verification and reset token fields. `deleted_at TIMESTAMPTZ NULL` is the soft delete. The row has a ManyToMany relation to the roles through `user_roles` |
| `oauth_accounts` | UUID PK. `provider` and `provider_id` are unique together. The FK to `users` uses CASCADE and has an index |
| `refresh_tokens` | UUID PK. `token` is a unique SHA-256 hash, and `@Exclude` keeps it off the wire. The FK to `users` uses CASCADE. The row also holds `expires_at` and `revoked` |
| `roles` | UUID PK, unique `name`, description, `isSystem` flag, `isSuper` flag |
| `resources` | UUID PK, unique `name`, unique `subject`, `displayName`, description, `isSystem` flag. CASL cannot resolve an ambiguous subject, and `check:permissions` enforces the uniqueness in CI. The `is_orphaned` boolean becomes true when a person removes the controller. The permissions of such a resource then give nothing, and a deny rule continues to apply until a person restores it. `allowed_action_names text[]` holds the permitted actions |
| `actions` | UUID PK, unique `name`, `displayName`, description, `isSystem` flag, `sortOrder` |
| `permissions` | UUID PK. `resource_id` and `action_id` are unique together, and the two are FKs to `resources` and `actions` |
| `role_permissions` | FK to `roles` and FK to `permissions`, plus an optional jsonb `conditions` column |
| `user_roles` | Join table of `user_id` and `role_id`, with a composite PK |
| `audit_logs` | UUID PK, `action` (enum), nullable `actorId`, nullable `actorEmail`, nullable `targetId`, nullable `targetType`, jsonb `details`, `ipAddress`, `requestId`, `createdAt` |

The billing tables are below. They are the foundation of the subscriptions, and the database always
keeps money in minor units.

The money and quantity columns that can overflow are `bigint` columns. They are
`billing_invoices.amount_minor`, `billing_invoices.refunded_minor`,
`billing_credit_balances.balance_units`, `billing_credit_ledger.delta` and
`billing_usage_records.quantity`.

`moneyColumnTransformer` (`common/utils/money-column.transformer.ts`) decodes such a column into a
`Money` BigInt value object. `@MoneyToNumber()` serializes it to a `number` on the wire. A pure
counter stays an `integer` column.

Each billing calculation goes through `Money`. There is no floating-point arithmetic. A conversion
between minor units and the decimal string of a provider takes its scale from the currency, through
`minorUnitScale()` (`shared/src/utils/money.ts`). It never uses a hardcoded 2. Thus the code handles
a currency with zero decimals and a currency with three decimals correctly.

| Table | Description |
|-------|-------------|
| `plans` | UUID PK, unique `key`, `name`, `billing_mode` (`fixed` or `usage`), `interval`, `meter_key` (for usage), `entitlements text[]` with a GIN index, `limits jsonb`, `trial_days`, `active`, `prices jsonb`. The `limits` column has the type of the closed `EntitlementLimits` map, and its keys come from the shared `EntitlementLimitKey` union, which currently holds `sessions`. The seeder writes Pro 10 and Business 25, and it leaves the value null on Free and on usage. The `prices` column holds `{ currency, amountMinor, unitPriceMinor?, includedUnits? }` for each provider |
| `billing_customers` | UUID PK, `user_id` (unique FK to `users`, CASCADE), `provider`, `provider_override` (the manual region override), `provider_customer_id`, `country`, `currency`, `default_payment_method_id` (FK to `billing_payment_methods`, SET NULL) |
| `billing_payment_methods` | UUID PK, `customer_id` (FK, CASCADE), `provider`, `provider_method_ref`, `brand`, `last4`, `is_default`. A partial unique index on `customer_id WHERE is_default` permits a maximum of one default for each customer |
| `subscriptions` | UUID PK, `customer_id` (FK, CASCADE), `plan_key`, `provider`, `billing_mode`, `status`. Also `lifecycle_owner` (`provider` or `self`), the bounds of the current period, `billing_anchor_at`, `cancel_at_period_end`, `trial_end`, `provider_subscription_id` and `payment_method_id` (FK, SET NULL). `billing_anchor_at` is nullable. It is the billing day that each self-managed boundary returns to, thus a February clamp cannot move a month-end customer backwards. A provider-managed row keeps it NULL |
| `billing_invoices` | UUID PK, `customer_id` (FK, RESTRICT), `subscription_id` (FK, SET NULL), `provider`. The FK to the customer uses RESTRICT, because a financial record must survive the deletion of a customer. Also `provider_event_id` (unique, for the webhook idempotency), `provider_invoice_ref`, `amount_minor`, `refunded_minor`, `currency`, `status` and `billing_mode`. Also `kind` (`subscription` or `one_time`) and `product_id` (FK to `billing_products`, SET NULL), which a one-time purchase uses. Also the period bounds, `paid_at` and `receipt_ref` (54-FZ). `refunded_minor` holds the cumulative refunded units. A refund is full when `refunded_minor` is equal to `amount_minor`, and partial when it is less. `@Exclude` keeps it off the wire |
| `billing_products` | UUID PK, unique `key`, `name`, description, `type` (`sku`, `credits` or `custom`), `prices jsonb`, `grant jsonb`, `active`. A fixed price holds `{ currency, amountMinor?, paddlePriceId? }` for each provider. A custom price holds `{ currency, minAmountMinor, maxAmountMinor }`. The grant holds `{ credits }` or `{ entitlement, durationDays? }`, and it is null for a custom product |
| `billing_customer_grants` | UUID PK, `customer_id` (FK, CASCADE, indexed), `entitlement`, `source_invoice_id` (FK to `billing_invoices`, CASCADE, for the idempotency and the refund revocation), `expires_at`, `revoked_at` |
| `billing_credit_balances` | `customer_id` PK (FK, CASCADE), `balance_units`, `updated_at`. The balance can become negative after a refund clawback, which blocks usage until the customer adds credits |
| `billing_credit_ledger` | UUID PK, `customer_id` (FK, RESTRICT, indexed), `delta`, `reason` (`purchase`, `usage` or `refund`), `ref_invoice_id` (FK to `billing_invoices`, SET NULL). The FK to the customer uses RESTRICT, because an audit journal must survive the deletion of a customer. The table is an append-only journal of each change of the balance |
| `billing_usage_records` | UUID PK, `customer_id` (FK, CASCADE), `subscription_id` (FK, CASCADE, indexed), `meter_key`, `quantity`, `occurred_at`, `idempotency_key`, `recorded_at`. The pair `(customer_id, idempotency_key)` is unique, and its index also serves the cascade lookup on `customer_id` |
| `billing_webhook_events` | UUID PK, `provider`, `provider_event_id`, `type`, nullable jsonb `payload`, `status` (`received`, `processed` or `dead_letter`, indexed with `received_at` for the reconciliation sweep), `attempts`, `last_error`, `received_at`, `processed_at`. The `payload` column holds the verified `NormalizedEvent` object, which the reconciliation sweep replays. The system keeps no form of the raw delivery body. The unique pair `(provider, provider_event_id)` makes a replay of a `processed` row a no-op, while the sweep reprocesses a stuck `received` row. A delivery that fails the sweep `WEBHOOK_MAX_REPLAY_ATTEMPTS` times becomes `dead_letter`. Such a row stops the churn and alerts one time. A person can still replay it with `POST /admin/billing/webhook-events/:id/replay`, or with a redelivery from the provider. The daily retention sweep bounds a settled row: it drops the payload, and then it deletes the row. A `received` row and a `dead_letter` row are exempt |

Each migration command and each seed command operates on the compiled JS in `dist/`. Always run
`npm run build` first.

Each seeder in `src/seeders/` is idempotent. The seeders cover RBAC, the feature flags, and the
billing plans and products. Each one finds a row by its natural key, that is `name` or `key`, and
inserts only what is missing. Thus `npm run seed:run` is safe against a database that already has the
data.

A seeder does not touch a row that an administrator edited. A seeder writes the rules of a feature
flag only beside a flag that it just made. Thus it does not restore a rule that a person deleted.

## Deployment behind a reverse proxy

The app can run behind nginx, Caddy, a Kubernetes ingress or Cloudflare. The TCP peer of each request
is then the proxy, and not the true client.

With no configuration, `req.ip` is the IP of the proxy for each request. That silently breaks three
things:

- `@nestjs/throttler`. Each request counts under one IP. Thus either each request uses the same
  quota, which is a global lockout, or the quota does nothing.
- The `login-long-window` throttler. That throttler protects against a brute-force account lockout.
- The IP record of `AuditService`. An audit log then shows the IP of the proxy and not the IP of the
  true client.

Set `TRUSTED_PROXIES`. Then Express trusts the `X-Forwarded-For` header from your proxy, and only
from your proxy. Examples:

| Deployment | Recommended value |
|------------|-------------------|
| nginx or Caddy on the same host | `loopback` |
| A sidecar proxy in Kubernetes | `loopback,uniquelocal` |
| Two hops, for example a CDN, then nginx, then the app | `2` |
| Cloudflare with no private-range proxy in front of it | The published CIDR list of Cloudflare, separated by commas |

Do **not** set `TRUSTED_PROXIES=true` unless you are sure that nothing untrusted can reach the app
directly. That value makes Express trust `X-Forwarded-For` from each source. A client can then spoof
its IP.

Refer to the Express [trust proxy docs](https://expressjs.com/en/guide/behind-proxies.html) for the
full syntax.

## Rate limiting

`CoreModule` configures the rate limiting through `@nestjs/throttler`. Two throttlers run in
parallel:

| Throttler | Window | Limit | Notes |
|-----------|--------|-------|-------|
| `default` (unnamed) | 60 s | 120 requests for each IP | A soft ceiling for the whole SPA. A `@Throttle({ default: { ttl, limit } })` decorator on a route replaces it on a sensitive endpoint |
| `login-long-window` | 15 min (`LOCKOUT_DURATION_MS`) | 4 999 (`MAX_FAILED_ATTEMPTS * 1000`) | It does nothing at the global level. `/auth/login` tightens it to `MAX_FAILED_ATTEMPTS - 1`. Thus one IP cannot collect enough failed attempts to trip the account-lockout protection (SEC-6). It counts a **failed** login only: `LoginThrottlerGuard` refunds the increment when the response finishes below 400. Thus a shared NAT egress cannot lock out its own users with a successful login |

`buildThrottlerOptions(REDIS_URL)` (`modules/core/throttler-options.ts`) builds the two throttlers.
With `REDIS_URL` set, the throttler uses `RedisThrottlerStorage`, thus each instance shares the
counters. Without it, the throttler uses `MemoryThrottlerStorage`, which serves one instance only.

`MemoryThrottlerStorage` exists because the refund above needs a `decrement` method.
`@nestjs/throttler` does not put that method on its `ThrottlerStorage` contract, and its own
`ThrottlerStorageService` implements `increment` and nothing else.

The two project storages implement `DecrementableThrottlerStorage`. `LoginThrottlerGuard` is typed
against that interface. Thus a storage with no refund is a compile error, and not a refund that
nobody applies.

`MemoryThrottlerStorage` also clamps the counter at zero on its way into `increment`. The base class
schedules one expiry timer for each hit, and that timer decreases the same counter. Thus a hit that
the guard already refunded drives the counter negative and gives extra attempts in the next window.

The billing webhook receivers, that is `POST /billing/webhooks/paddle` and
`POST /billing/webhooks/yookassa`, carry `@SkipThrottle()`.

A payment provider delivers from a small set of egress IPs. Thus each webhook of a provider shares one
bucket for that IP, and a legitimate batch of renewals gets a 429.

The signature verification of Paddle and the API re-fetch of YooKassa enforce the authenticity. The
ingestion is idempotent. Thus the throttle adds no protection on these routes. With the throttle off,
the source-IP allowlist below bounds the unauthenticated traffic to them.

### Billing webhook source-IP allowlist

`WebhookIpAllowlistGuard` rejects a request to `/billing/webhooks/*` with a `403` unless the client IP
matches `BILLING_WEBHOOK_IP_ALLOWLIST`. That variable holds IPs and CIDRs, separated by commas, and
it supports IPv6.

The check runs before any webhook processing. In particular it runs before the outbound payment
re-fetch of YooKassa. Without the check, an arbitrary host on the internet can start that re-fetch at
will. A YooKassa notification has no signature by design. For Paddle, which has an HMAC, the
allowlist is defense in depth.

- An empty or unset value disables the check. Thus local development and the e2e suites run open.
- `docker-compose.yml` sets the production default to the egress ranges of the providers. Those
  ranges are at
  [Paddle: respond to webhooks](https://developer.paddle.com/webhooks/about/respond-to-webhooks/) for
  live and sandbox, and at [YooKassa: webhooks](https://yookassa.ru/developers/using-api/webhooks). A
  person verified the two pages on 2026-07-05. The two providers recommend an allowlist.
- **Update procedure.** If a provider starts to get a rejection, read the two pages again and update
  the default in `docker-compose.yml`. The guard logs each rejection as a warning with the source IP.
  To disable the check for a short time with no edit of the file, export
  `BILLING_WEBHOOK_IP_ALLOWLIST` as empty.
- A malformed entry stops the startup, and this is intentional. A deploy that cannot enforce the list
  must fail loudly. It must not fall open or drop a webhook silently.
- The guard reads `req.ip`. Thus behind a reverse proxy you must configure `TRUSTED_PROXIES`. Refer to
  [Deployment behind a reverse proxy](#deployment-behind-a-reverse-proxy). The guard ignores a
  spoofed `X-Forwarded-For` header from an untrusted peer.

These routes currently replace the default limit:

| Endpoint | Window | Limit | Why |
|----------|--------|-------|-----|
| `POST /auth/register` | 1 h | 5 | To control a flood of new accounts. The CAPTCHA soft trigger starts near the limit |
| `POST /auth/login` | 1 min | 3 (default) plus `login-long-window` | To protect against a brute force of the credentials, and to protect the lockout |
| `POST /auth/refresh-token` | 1 min | 5 | It is bound to a true session, thus abuse means a stolen cookie |
| `POST /auth/profile/email/initiate` | 1 h | 3 | The cost of a confirmation email, and enumeration mitigation |
| `POST /auth/profile/email/confirm` | 1 min | 10 | Defense in depth against a token brute force. The token entropy already makes that infeasible |
| `POST /auth/verify-email` | 1 min | 10 | The same |
| `POST /auth/resend-verification` | 1 min | 3 | The cost of an email |
| `POST /auth/forgot-password` | 5 min | 2 | The cost of an email, and enumeration mitigation. The CAPTCHA soft trigger starts near the limit |
| `POST /auth/reset-password` | 1 min | 10 | Defense in depth against a token brute force |
| `POST /auth/oauth/exchange` | 1 min | 10 | It is bound to a state token. The limit is tight enough to stop a replay attempt |
| `GET /rbac/metadata` | 1 min | 30 | The limit is higher, because each administrator route guard reads it |

A rejected request gets the standard `429` answer with
`{ statusCode, message, error, timestamp, path }`.

## Enabling CAPTCHA in production

The CAPTCHA on `/register` and `/forgot-password` is **disabled by default**. After a deploy, only
the rate limiter protects the two endpoints. The limits are 5 requests each hour for the register
route, and 2 requests each 5 minutes for the forgot-password route, for each IP.

Do these steps to enable a Cloudflare Turnstile soft-trigger challenge. The challenge then activates
when an IP comes near the rate limit.

1. **Get the keys from Cloudflare.** This is free and takes approximately 2 minutes.
   - Sign in at https://dash.cloudflare.com. Each plan works, and the Free plan is sufficient.
   - Open **Turnstile**, then **Add site**.
   - Enter your production domain. Only that domain can use the site key. Thus a person cannot embed
     your key on another site.
   - Set the Widget Mode to **Managed**. Cloudflare then selects an interactive challenge or an
     invisible challenge from the risk score. This mode is the recommended one.
   - Save the site, and copy the **Site Key** and the **Secret Key**.

2. **Set the keys.** Select one of the two methods.

   **The recommended method, which survives a rebuild.** Add the two values as GitHub repository
   secrets: `TURNSTILE_SITE_KEY` for the public site key, and `TURNSTILE_SECRET_KEY` for the
   sensitive secret key.

   At the next `deploy.yml` or `rebuild.yml` run, `scripts/sync-prod-env.sh` writes the two into the
   VPS file `server/.env` automatically. They join the same managed list as `SMTP_*`, `JWT_*` and
   `DB_PASSWORD`. Refer to the section "Production credentials and secrets" in the root `README.md`.
   A rebuild of the VPS from nothing restores them with each other managed secret.

   **A quick local edit.** The next deploy overwrites this when the GitHub secret has a value.
   ```bash
   ssh user@your-vps
   cd /path/to/project
   nano server/.env
   # Add or replace:
   #   TURNSTILE_SITE_KEY=0x4AAAAAAA...      your real Site Key
   #   TURNSTILE_SECRET_KEY=0x4AAAAAAA...    your real Secret Key
   chmod 600 server/.env
   ```

3. **Apply the change.**
   - **For the GitHub-secrets method:** start a deploy. Push to master, or run `deploy.yml` with
     `workflow_dispatch`. The sync script writes the keys, and then `docker compose up -d` reads
     them.
   - **For the local-edit method:** restart the `server` service only:
     ```bash
     docker compose up -d server
     ```

   The client needs no new build in the two cases. It reads the public site key at run time from
   `GET /api/v1/auth/captcha-config`.

4. **Verify the result.**
   ```bash
   curl https://your-domain/api/v1/auth/captcha-config
   # gives {"enabled":true,"provider":"turnstile","siteKey":"0x4AAAAAAA..."}
   ```
   Then open `/register` in a browser and submit the form 4 times in sequence. Use a different email
   address each time, or expect a 409 for an address that exists. The widget must appear at the 4th
   attempt. After you solve it, the registration completes.

5. **Disable the CAPTCHA for a short time.** Do this, for example, when Cloudflare has an outage and
   the `Turnstile siteverify request failed` message fills the log.

   Clear the two `TURNSTILE_*` GitHub secrets, that is set an empty value, and start a deploy. The
   sync script skips an empty value. Thus this step alone does **not** clear `server/.env`. For an
   immediate correction, also comment the keys out on the VPS:
   ```bash
   sed -i 's/^TURNSTILE_/# TURNSTILE_/' server/.env
   docker compose up -d server
   ```
   To enable the CAPTCHA again, restore the secrets. Also remove the comment characters if you used
   the manual method.

### Content-Security-Policy requirements

The Turnstile script and the challenge widget load from `https://challenges.cloudflare.com`.

The CSP of the client **must** permit that host in `script-src`, for
`api.js?render=explicit`, and in `frame-src`, for the embedded challenge iframe.

Without the two directives, the backend continues to answer `CAPTCHA_REQUIRED` while the browser
blocks the widget silently. The user then sees only the error "Please complete the CAPTCHA challenge
to continue", and there is no widget to solve.

The `client/nginx.conf` file of the project already has the two directives in each
`add_header Content-Security-Policy` rule.

You can put a different reverse proxy or CDN in front of the client, for example Caddy, Cloudflare or
CloudFront. You can also customize the nginx configuration. In those conditions, make sure that the
CSP that the server sends holds these two lines:

```
script-src 'self' https://challenges.cloudflare.com
frame-src https://challenges.cloudflare.com
```

To check this quickly from any environment:
```bash
curl -sI https://your-domain/ | grep -i content-security-policy
```

### Test keys against production keys

| Key pair | Behaviour | Use case |
|----------|-----------|----------|
| `1x00000000000000000000AA` / `1x0000000000000000000000000000000AA` | It always passes. It is public, thus each person can make a token | Local development, unit tests and CI. **Never production** |
| `2x00000000000000000000AB` / `2x0000000000000000000000000000000AA` | It always blocks. It is useful to test the failure path | A negative-path test |
| A true Site Key and Secret Key from your dashboard | A true challenge that machine learning drives | Production |

The test keys are **public**, thus a bot can also use them. They give no protection against abuse.

A production deploy that keeps a test value in `TURNSTILE_*` is the same as a deploy with no CAPTCHA.
It is worse in one way: the user sees a widget that does nothing useful.

### An alternative to a dependency on Cloudflare

The throttler alone gives reasonable protection against a brute force from one IP. Its limits are 5
requests each hour on the register route, and 2 requests each 5 minutes on the forgot-password route.

If you see spam in `audit_logs` although the throttler runs, you have three options:

- Change the provider to hCaptcha. Change the `siteverify` URL in `CaptchaService`, and the script
  URL in `CaptchaService.loadScript()`. The protocol is identical: a form-encoded `secret` and
  `response` request, and a JSON `{ success: boolean }` answer. hCaptcha also needs an account.
- Host a proof-of-work challenge yourself, with no CAPTCHA. mCaptcha and Friendly Captcha are two
  such tools. This adds a container to `docker-compose.yml`, and it needs no external account.
- Add a honeypot field and a minimum form-fill time as a first line. This operates immediately and
  needs no third party. A more capable bot gets past it.

## Observability

### Prometheus metrics

`MetricsModule` (`src/modules/core/metrics/metrics.module.ts`) exposes `GET /metrics`. That route is
outside the `/api` prefix.

The route carries no bearer token, because it is `@Public()`. `InternalNetworkGuard`
(`src/modules/core/metrics/internal-network.guard.ts`) gates it instead. The server answers only a
request whose `req.ip` value is a loopback, private or unique-local address. Each other source gets a
`403`.

`req.ip` obeys the `trust proxy` setting (`TRUSTED_PROXIES`). Thus a spoofed `X-Forwarded-For` header
from an untrusted peer cannot get past the guard.

These are the counters and the histograms:

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | counter | `method`, `route`, `status_code` | Each HTTP request that reaches the app |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status_code` | The latency of each route, in seconds |
| `auth_events_total` | counter | `event`, one of `login_success`, `login_failure`, `token_refresh_success`, `token_refresh_failure`, `token_reuse_detected`, `logout`, `register` | The authentication events |
| `rbac_permission_denied_total` | counter | `action`, `subject`, `level`, one of `guard` or `instance` | The RBAC and ABAC denials. `level=guard` is a rejection from the `@Authorize` decorator. `level=instance` is an `ability.can(action, entity)` rejection after the server loaded the record |
| `sse_connections_active` | gauge | - | The SSE notification streams that are open now |
| `mail_queue_jobs` | gauge | `state`, one of `waiting`, `active`, `completed`, `failed`, `delayed` | The depth of the BullMQ mail queue, by job state. The metric stays absent when no queue is configured, that is when `REDIS_URL` is empty and `MailService` sends the mail in the process |
| `mail_jobs_processed_total` | counter | `outcome`, one of `completed` or `failed` | The mail jobs that the queue worker processed. `failed` counts each failed attempt, and a retry is one attempt |
| `db_pool_connections` | gauge | `state`, one of `total`, `idle`, `waiting` | The size of the PostgreSQL connection pool, by state. The metric reads the pg pool on the injected `DataSource` object. A `waiting` value above 0 for a long time means that the pool is exhausted and the requests are in a queue |
| `cache_requests_total` | counter | `cache`, one of `permissions`, `roles`, `resources`, `feature_flags`, `feature_flags_all`; and `outcome`, one of `hit` or `miss` | The lookups in each Redis-backed cache, by logical cache and by outcome. The hit ratio of a cache is `hit / (hit + miss)`. A ratio that stays low means that the invalidation is faster than the hits |
| `dependency_up` | gauge | `dependency`, one of `smtp` or `redis` | The health of an external dependency, as `/health/ready` last observed it. `1` is healthy, and `0` is degraded or down. A series appears only after its indicator runs. Thus a deployment with no SMTP configuration never emits `dependency="smtp"`. This is the only machine-readable signal for a degradation that readiness intentionally reports as up. Refer to [Alerting](../README.md#alerting) |
| `billing_usage_records_unrated_total` | counter | `meter` | The usage records that the system stored under a meter that the current plan of the customer does not price. A value above zero is expected while a customer meters a product that they do not subscribe to. A rise that continues on one `meter` means that a producer uses an incorrect key, and its units silently do not bill. The plan catalog bounds the label cardinality, because the ingest refuses a meter that no plan declares |

`prom-client` also supplies the default Node.js process metrics. Those cover the heap, the GC, the
event-loop lag and the file descriptors.

### Scrape configuration

The `monitoring/prometheus.yml` file of the project already targets `server:3000` at the `/metrics`
path. The interval is 15 seconds, inside the Docker Compose network. A self-hosted Prometheus
instance must add an equivalent scrape job.

### Permission-denied alert recipes

`rbac_permission_denied_total` is the best single signal for unexpected RBAC behavior. It shows a
misconfigured role, a brute-force probe of the administrator routes, a front-end defect that calls an
endpoint that the user cannot use, and a regression that adds a new check before a person updates the
seed data.

Put the rules below in a Prometheus rules file, for example `monitoring/rbac-rules.yml`. Load that
file with `rule_files:` in `prometheus.yml`. Each threshold is a starting point. Tune it against your
own baseline traffic before you page a person on it.

```yaml
groups:
  - name: rbac
    rules:
      # 1. Burst: more than 10 denials/min averaged over a 5-min window.
      # Usually points at a deploy that broke a role, or a runaway script.
      - alert: RbacDenialBurst
        expr: sum(rate(rbac_permission_denied_total[5m])) * 60 > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "RBAC denials averaging above 10/min over 5 min"
          description: |
            Per-subject breakdown:
              sum by (subject, action) (rate(rbac_permission_denied_total[5m]))

      # 2. Concentrated abuse: one subject takes more than 70 % of denials.
      # Typical when a single role / UI screen is denied repeatedly.
      - alert: RbacDenialHotSubject
        expr: |
          (
            max(sum by (subject) (rate(rbac_permission_denied_total[10m])))
            /
            sum(rate(rbac_permission_denied_total[10m]))
          ) > 0.7
          and
          sum(rate(rbac_permission_denied_total[10m])) > 0.05
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Single subject accounts for more than 70 % of RBAC denials"

      # 3. Instance-level denial spike - usually an ownership-check bug or
      # a tampered client cache. Guards block typed access; instance checks
      # block "you do not own this row", so a sudden rise often means the UI
      # is showing rows that must not be visible.
      - alert: RbacInstanceDenialSpike
        expr: sum(rate(rbac_permission_denied_total{level="instance"}[5m])) * 60 > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Instance-level RBAC denials above 5/min over 5 min"

      # 4. Sustained background noise - under steady load these counters
      # must sit near zero for an authenticated user. A long-running
      # trickle is usually a broken UI that hides nothing client-side.
      - alert: RbacDenialChronic
        expr: sum(rate(rbac_permission_denied_total[30m])) * 60 > 2
        for: 30m
        labels:
          severity: info
        annotations:
          summary: "RBAC denials above 2/min for 30 min (likely a UI bug, not abuse)"
```

For a deployment with low traffic, replace `rate(...)` with
`increase(rbac_permission_denied_total[1h]) > N`. Thus the noise of a ratio against a small base does
not hide the alert.

### Grafana dashboard

A starter dashboard is at `doc/grafana/rbac.json`. It shows the breakdown of the permission denials.
The `doc/` folder of the project is intentionally in `.gitignore`. Thus you must copy the file or
make a symbolic link to it where you need it.

To import it, open **Grafana**, then **Dashboards**, then **New**, then **Import**. Select the
Prometheus datasource of the Docker stack, which has the UID `prometheus`.

The panels are:

- Denials each minute, overall, over a 5-minute window. It is a single stat.
- Denials each second by level, that is `guard` against `instance`. It is a time series.
- The top pairs of subject and action over 5 minutes. It is a bar gauge.
- The distribution of the denials by subject over 1 hour. It is a pie chart.
- The cumulative denials by pair of subject and action over 24 hours. It is a table.

The provisioned **App Metrics** dashboard is at
`monitoring/grafana/provisioning/dashboards/nexus.json`. It covers the other metrics, that is the
HTTP traffic, the authentication events, the p95 latencies, the SSE streams and the Node.js runtime.

It also has an RBAC and Reliability section. That section shows the permission denials by level and
by action and subject, the process RSS memory, the token-reuse-detected alarm, the uptime, and the
active handles and requests.

It has a Mail Queue section, with the BullMQ depth by state and the counts of the failed and
completed jobs over 1 hour. It has a Database section, with the connection-pool size by state and an
alarm for the waiting connections.

Use the dedicated RBAC dashboard (`doc/grafana/rbac.json`) beside it for a deeper security
investigation.

## Docker

The `Dockerfile` has more than one stage, for a production build.

**Build stages:**
1. **deps** installs the production `node_modules` only, with `npm ci --omit=dev`.
2. **builder** installs each dependency and compiles the TypeScript with `nest build`. The build
   includes `shared/`.
3. **runner** copies `dist/` and the production `node_modules`. It runs `docker-entrypoint.sh`.

**`docker-entrypoint.sh`** runs at the start of the container:
```sh
typeorm migration:run      # Apply pending migrations
node dist/server/src/seed-admin.js   # Create admin user if ADMIN_EMAIL set
exec node dist/server/src/main       # Start NestJS
```

The administrator seeder (`src/seed-admin.ts`) reads `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
`ADMIN_FIRST_NAME` and `ADMIN_LAST_NAME` from the environment. It is idempotent: it skips the work
when the user exists, and when `ADMIN_EMAIL` has no value.

**The seeder must never exit non-zero, and `seed-admin.spec.ts` pins that.** The entrypoint runs it
under `set -e`, so any non-zero exit aborts the entrypoint and the API never starts. It checks the
breached-password blocklist on the branch that creates the user, and a listed `ADMIN_PASSWORD`
produces a WARNING in the deploy log, not a refusal. Trading the whole API for a weak seed password
is not a trade worth making, and it caused a production outage on 2026-09-02.

The `docker-compose.yml` file in the root of the repository is the **production** stack. It holds the
db, redis, server, client and monitoring services, and the deploy puts it on the VPS. Do not use it
locally.

For local development, run the API on the host with `npm run start:dev`. Run it against the dev
backing services in `server/docker-compose.yml`.

---

## API

The Swagger documentation is at http://localhost:3000/swagger. It is on by default in `local` and in
`development`. To enable it in another environment, set `SWAGGER_ENABLED=true`.

The base URL is `/api/v1`.

### Auth (`/api/v1/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | None | Register a user and send a verification email. A taken address answers 409 and writes a `USER_REGISTER_CONFLICT` audit row. The existence of an account is intentionally discoverable here, thus the mitigation is detection. Refer to the "Account enumeration" row in the security section of the project spec |
| POST | `/login` | None | Log in. It returns a JWT and a refresh token |
| POST | `/refresh-token` | None | Refresh the access token |
| POST | `/logout` | Bearer | End the session of this device |
| GET | `/profile` | Bearer | Get the current user |
| PATCH | `/profile` | Bearer | Update your own profile: the name and the password. A password change needs a fresh proof of identity with whatever factor the account holds: `currentPassword` for an account that has one, and a `reauth_proof` cookie minted for `password_set` for an account with OAuth only |
| POST | `/profile/email/initiate` | Bearer | Step 1 of the self-service email change, with a limit of 3 calls each hour. It requires a fresh proof of identity with whatever factor the account holds: `currentPassword` for an account that has one, and a `reauth_proof` cookie from a provider round trip for an account that has none. It stores `pendingEmail` and `pendingEmailToken` with an expiry of 1 h. It sends a confirmation link to the new address, and a masked alert with no link to the old address. The response is enumeration-safe |
| POST | `/profile/email/confirm` | None | Step 2. It confirms the new address with the token, applies the change atomically, revokes each refresh token, and notifies the old address |
| GET | `/permissions` | Bearer | Get the resolved permissions of the current user |
| POST | `/verify-email` | None | Verify an email address with a token |
| POST | `/resend-verification` | None | Send the verification email again, with a limit of 3 calls each minute |
| POST | `/forgot-password` | None | Request a password reset email, with a limit of 2 calls each 5 minutes. A CAPTCHA token is necessary near the rate limit |
| POST | `/reset-password` | None | Reset the password with a token |
| GET | `/captcha-config` | None | The public CAPTCHA configuration: the provider, the site key and the enabled flag |

### OAuth (`/api/v1/auth/oauth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/:provider` | None | Start an OAuth login. The providers are google, facebook and vk |
| GET | `/:provider/callback` | None | The callback of the OAuth provider. It redirects to the client |
| GET | `/accounts` | Bearer | List the linked OAuth accounts |
| DELETE | `/accounts/:provider` | Bearer | Unlink an OAuth provider |

### Roles (`/api/v1/roles`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | `roles:create` | Create a role |
| GET | `/` | `roles:read` | List each role with its permissions |
| GET | `/:id` | `roles:read` | Get a role by ID |
| PATCH | `/:id` | `roles:update` | Update a role |
| DELETE | `/:id` | `roles:delete` | Delete a role |
| GET | `/permissions` | `roles:read` | List each available permission |
| GET | `/:id/permissions` | `roles:read` | Get the permissions of one role |
| PUT | `/:id/permissions` | `roles:update` | Replace the full permission set of a role |
| POST | `/:id/permissions` | `roles:update` | Assign permissions to a role |
| DELETE | `/:id/permissions/:permissionId` | `roles:update` | Remove a permission from a role |
| POST | `/assign/:userId` | `roles:assign` | Assign a role to a user. It answers 404 when the user is unknown or soft-deleted |
| DELETE | `/assign/:userId/:roleId` | `roles:assign` | Remove a role from a user. It answers 404 when the user is unknown or soft-deleted |

### RBAC (`/api/v1/rbac`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/metadata` | `permissions:read` | Get the RBAC metadata: the resources and the actions. Redis caches it for 60 s |
| GET | `/resources` | `permissions:read` | List each resource |
| PATCH | `/resources/:id` | `permissions:update` | Update the display data of a resource |
| POST | `/resources/:id/restore` | `permissions:update` | Restore an orphaned resource. It answers 400 when no `@RegisterResource` controller exists |
| GET | `/actions` | `permissions:read` | List each action |
| POST | `/actions` | `permissions:create` | Create a new action |
| PATCH | `/actions/:id` | `permissions:update` | Update an action |
| DELETE | `/actions/:id` | `permissions:delete` | Delete a custom action |

### Notifications (`/api/v1/notifications`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/stream` | Bearer | The SSE stream. It pushes `session_invalidated`, `permissions_updated`, `user_crud_events` and `feature_flags_updated`. `user_crud_events` goes only to a client with `users:search` |

### Feature Flags (`/api/v1`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/feature-flags` | Optional | The evaluated flags of the caller. An authenticated caller gets each flag that resolves `true` plus each `public` flag, and the server omits a disabled non-public flag. An anonymous caller gets the flags with `public: true`. It returns `{ flags: Record<string, boolean>, evaluatedAt: string }`. It sets the `nxs_anon_id` cookie at the first request |
| GET | `/admin/feature-flags` | `manage:FeatureFlag` | List each flag with its rules |
| GET | `/admin/feature-flags/:id` | `manage:FeatureFlag` | Get a flag by ID |
| POST | `/admin/feature-flags` | `manage:FeatureFlag` | Create a flag. The audit action is `FEATURE_FLAG_CREATE` |
| PATCH | `/admin/feature-flags/:id` | `manage:FeatureFlag` | Update a flag. It **requires the `If-Match: <version>` header**. A mismatch gives HTTP 409 with `errorKey: errors.featureFlags.versionConflict`. A missing header gives HTTP 428 with `errors.featureFlags.ifMatchRequired` |
| DELETE | `/admin/feature-flags/:id` | `manage:FeatureFlag` | Delete a flag with a cascade. The audit action is `FEATURE_FLAG_DELETE` |
| PUT | `/admin/feature-flags/:id/rules` | `manage:FeatureFlag` | Replace the full rule set in one transaction. The audit action is `FEATURE_FLAG_RULES_REPLACE` |
| POST | `/admin/feature-flags/:id/toggle` | `manage:FeatureFlag` | Change `enabled` and increase the version. The audit action is `FEATURE_FLAG_TOGGLE` |
| POST | `/admin/feature-flags/:id/preview` | `manage:FeatureFlag` | Evaluate the flag against a synthetic context and write nothing. The body can carry an unsaved `rules`, `enabled` and `environments` set, which the server evaluates in place of the stored flag. A supplied rule set goes through the validator of `PUT /:id/rules`, thus it gets the same 400. The `reason` field is one of `disabled`, `env-mismatch`, `excluded`, `included-by-rule`, `no-rules-default-on` and `not-included`. `excluded` says that an exclude rule matched. `not-included` says that include rules exist and that no rule matched |

**Caching.** The system uses three keys:

- `featureflags:all` holds the full set of flags and rules, with a TTL of 300 s. A reload is
  single-flight: two concurrent misses share one load from the database. A load that an invalidation
  overlaps skips its cache write, through a generation guard. Thus the cache never holds a row from
  before the change.
- `featureflags:version` is a monotonic counter. Each change increases it. The value goes at the end
  of each per-user key, thus an old entry orphans itself.
- `featureflags:user:<userId>:v<version>` holds the evaluated map, with a TTL of 60 s. The system
  caches nothing for an anonymous caller.

**Real-time updates.** `FeatureFlagChangedListener` broadcasts `{ type: 'feature_flags_updated' }`
over SSE at each change of a flag.

The system invalidates the cache at each change. It coalesces the broadcast in a window of 500 ms.
Thus a burst of changes causes one synchronized refetch on the client, and not one refetch for each
change. One save in a dialog is such a burst, because it emits an update and a rules-replaced event.

`UserRoleChangedEvent` and `UserDeletedEvent` invalidate the cache of the affected user only. The
cross-module communication uses `EventEmitter2` and never `forwardRef`.

**Anonymous bucketing.** `AnonIdMiddleware` issues the `nxs_anon_id` cookie at the first request to
any route. The cookie uses `SameSite=Lax`, `Secure` in production, a `maxAge` of 1 year, and
`httpOnly: false`.

The value of the cookie seeds the hash of the percentage bucket. Thus a 10 % rollout of a public flag
converges on the same 10 % of anonymous browsers across reloads.

> **An anonymous percentage rollout is deterministic but the client can control it. It is not a
> security boundary.** The bucket key of an anonymous caller is the `nxs_anon_id` cookie, which is
> `httpOnly: false`. Thus JavaScript can read it and write it, and a client can rotate the cookie
> until it lands in a targeted bucket.
>
> This is acceptable by design. An anonymous caller sees only a flag with `public: true`. A sensitive
> feature must require authentication. The bucketing then keys on the `userId` value, which is
> immutable and which the client cannot control.
>
> Never use an anonymous percentage rollout for access control or for data isolation. Use it as a
> mechanism for gradual exposure only. If a future flag needs an anonymous rollout that resists this
> attack, sign the `nxs_anon_id` value with an HMAC and a server secret. A client can then not forge a
> bucket.

**The `@RequireFeature('key')` decorator** is a convenience:
```ts
@Get('/beta')
@RequireFeature('new-dashboard')
@Authorize(['read', 'Dashboard'])  // RBAC remains the real gate
getBetaDashboard() { ... }
```
`FeatureFlagGuard` returns HTTP 404 against enumeration when the flag is disabled for the caller.
**Never use it as the only authorization gate.**

**To extend the attribute registry** for a target that is not bound to a user, such as a tenant, an
organization, a region or a subscription tier:
```ts
@Injectable()
export class TenantModule implements OnModuleInit {
  constructor(
    private readonly registry: AttributeRegistryService,
    private readonly tenants: TenantLookupService
  ) {}
  onModuleInit() {
    this.registry.registerAttribute('tenantId', (user) =>
      user ? this.tenants.tenantIdForUser(user.userId) : null
    );
  }
}
```
An administrator UI can then write a rule such as
`{ field: 'custom', customKey: 'tenantId', op: 'in', value: ['acme', 'globex'] }`. The validator at
write time rejects a `customKey` value that nobody registered.
`GET /admin/feature-flags/attribute-keys` reports the registered set, thus the new key appears in the
rule editor of the client with no change there. That route reports the keys only. It never reports a
resolved value, because a resolver can carry personal data.

> **The resolver contract is request-stable.** A resolver MUST return a stable value for a given user
> across requests. It can use the `user` argument. It MUST NOT branch on per-request data, such as
> the IP address, a header, the query string or the country.
>
> `evaluateForUser` caches the full evaluated set for each user for 60 s, under
> `featureflags:user:<id>:v<version>`. Thus an attribute that comes from the request freezes the
> value of the first request for the full TTL, and the attribute rules then give a different result
> for each request.
>
> The resolver gets `req` for stable enrichment that does not depend on the request.

**Audit trail.** Each mutating administrator endpoint writes to `audit_logs` under one of the
`FEATURE_FLAG_*` enum values. Those are `FEATURE_FLAG_CREATE`, `FEATURE_FLAG_UPDATE`,
`FEATURE_FLAG_DELETE`, `FEATURE_FLAG_TOGGLE` and `FEATURE_FLAG_RULES_REPLACE`.

The `details` JSONB column holds `key`, `changedFields`, `ruleCount` or `enabled`, and the action
decides which one. It never holds the raw rule payload. Thus the segmentation strategy, which is
administrator-only data, never reaches the audit log.

**To add a new flag from a feature module.** The flag site needs no code above
`@RequireFeature('key')` on the handler. The configuration is entirely at run time. Make the flag
through the administrator UI or API. Attach the rules if you want a partial rollout. Then verify the
result with `GET /api/v1/feature-flags` as the target caller.

The `key` of a flag is a free-form string of lowercase letters, digits and hyphens. Give it the same
name as the gate. Thus a later reader can go from the code to the configuration with a grep.

### Users (`/api/v1/users`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | `users:create` | Create a user |
| GET | `/cursor` | `users:search` | List the users with cursor (keyset) pagination. `includeDeleted=true` adds the soft-deleted rows |
| GET | `/search/cursor` | `users:search` | Search the users with cursor pagination. The filters are `q` (a substring across the id, email, firstName and lastName), `email`, `firstName`, `lastName`, `role` (an exact role name) and `isActive`. `includeDeleted=true` adds the soft-deleted rows. A string filter has a cap of 255 characters. `isActive` and `includeDeleted` accept `true` or `false` only, and each other value is a 400 |
| GET | `/:id` | `users:read` | Get a user by ID |
| GET | `/:id/permissions` | `users:read` | Get the effective permissions of a user: the roles, the resolved permissions and the packed CASL rules |
| PATCH | `/:id` | `users:update` | Update a user: the email, the name, the password, `isActive` to deactivate or reactivate, and `unlockAccount` |
| DELETE | `/:id` | `users:delete` | Soft-delete a user. It sets `deleted_at` and revokes each active session |
| POST | `/:id/restore` | `users:delete` | Restore a soft-deleted user. It clears `deleted_at` and sets `isActive=true` |

**Cursor pagination query parameters** for `/cursor` and `/search/cursor`:
- `cursor` is the opaque token from the previous response. Omit it for the first page.
- `limit` has the default 20 and the maximum 100.
- `sortBy` has the default `createdAt`.
- `sortOrder` has the default `desc`.

**The response format of a cursor-paginated endpoint:**
```json
{
  "data": [UserResponseDto, ...],
  "meta": {
    "nextCursor": "eyJzb3J0VmFsdW...",
    "hasMore": true,
    "limit": 20
  }
}
```

Each list endpoint of this API uses cursor pagination. Offset pagination does not exist in this
repository.

## Testing

### Unit Tests (Jest)

- A test file is a `*.spec.ts` file beside its source file.
- The environment is Node.
- **Test mocks.** A partial mock uses the type of the real object, that is
  `jest.Mocked<Pick<T, ...>>`. Where the real type is impractically large, the mock uses a scoped
  `// @ts-expect-error` comment. Four such types are `ExecutionContext`, `EntityManager`,
  `DataSource` and `Repository<T>`.

  A `no-restricted-syntax` ESLint rule bans an `as unknown as T` double cast.

  The reusable fakes for a context, a configuration and an Express object are in
  `src/common/testing/`. The production build excludes that directory.

```bash
npm test                   # Run all
npm run test:watch         # Watch mode
npm run test:cov           # Coverage report
npx jest --testPathPattern=auth   # Run specific tests
```

### E2E Tests (Jest)

The configuration is separate, in `test/jest-e2e.json`.

```bash
npm run test:e2e
```

**Database settings.** The run needs Postgres. It takes each `DB_*` value from the environment first,
and from `.env` for each value that the environment does not give.

Thus `npm run test:e2e` operates with no export at all, and the explicit values of CI still win.

For that reason a partial export, for example `DB_HOST=localhost` alone, no longer leaves the
credentials behind. That condition used to appear as the message `client password must be a string`
from deep inside the driver.

`global-setup.ts` opens one connection before the workers fork. Thus a database that is unreachable
or unmigrated is reported one time, by name, and not one time for each suite.

**Mail settings.** The run resolves `SMTP_HOST`, `SMTP_PORT` and `MAILPIT_URL` in the same way.
`test/email-delivery.e2e-spec.ts` runs only when `SMTP_HOST` has a value.

To exercise the delivery path locally, point that variable at a local Mailpit instance, that is
`SMTP_HOST=localhost` and `SMTP_PORT=1025`, in `.env`. To skip the test, leave the variable empty.

**Rate-limit counters.** A suite that logs in more than a few times pins the throttler to an
in-memory store for each application (`test/private-throttler.ts`).

Without Redis, which is how CI runs, each application already gets its own store. A local run with
Redis shares one store across each worker. The `/auth/login` limit of 3 calls each minute for each IP
is then spent by whichever suite arrives first.

The helper installs `MemoryThrottlerStorage`, and not the storage of the library. Thus a pinned suite
keeps the refund of a successful login. A suite that asserts on the rate limiting keeps the true
storage.

**Redis isolation.** When a Redis URL is configured, from the environment or from `.env`, the run
uses a dedicated logical database. That is `E2E_REDIS_DB`, with the default `15`. The run clears that
database before the first test and after the last test.

Without that isolation, a throttler counter from one run outlives it, because the window of the login
throttler is `LOCKOUT_DURATION_MS`. A later run then gets a `429` where it expects a `401`.

The run rejects database `0` as a target, because that database holds the development cache and the
queues.

To exercise the in-memory throttler instead, run with `REDIS_URL=` empty. CI does this, because the
workflows have no Redis service.

## Shared Module

The server imports the common types and constants from the root `shared/` directory. It uses the
`@app/shared/*` path alias, which maps to `../shared/src/*` in `tsconfig.json`.

The import covers:

- **Types.** `UserResponse` is the public form. `AdminUserResponse` is the administrator superset,
  with `lockedUntil` and `roles: RoleAdminResponse[]`. The other types are `OAuthAccountResponse`,
  `TokensResponse`, `AuthResponse`, `CursorPaginationMeta`, `CursorPaginatedResponse<T>` and
  `SortOrder`.

  `RoleResponse` is the public form, with no `isSystem` and no `isSuper`. `RoleAdminResponse` is the
  administrator superset. The other role types are `PermissionResponse`, `RolePermissionResponse`,
  `RoleWithPermissionsResponse`, `PermissionCondition`, `PermissionEffect`, `ResolvedPermission`,
  `UserPermissionsResponse` and `UserEffectivePermissionsResponse`.

  The RBAC types are `ResourceResponse`, `ActionResponse` and `RbacMetadataResponse`.
- **Constants.** They are `MIN_PASSWORD_LENGTH`,
  `MAX_PASSWORD_LENGTH`, `MAX_NEW_PASSWORD_LENGTH`, `MAX_NEW_PASSWORD_BYTES`,
  `MAX_FAILED_ATTEMPTS`, `LOCKOUT_DURATION_MS`, `MAX_CONCURRENT_SESSIONS`,
  `MAX_PAGE_SIZE`, `DEFAULT_CURSOR_PAGE_SIZE`, the user sort columns, `SYSTEM_ROLES` and
  `SystemRole`.

  The password DTOs read these length constants, thus `@MinLength` and `@MaxLength` cannot drift
  away from the client form rules. A DTO field that **sets** a password reads
  `MAX_NEW_PASSWORD_LENGTH`, which is 72, and adds `@IsWithinPasswordByteLimit()`
  (`src/common/validators/password-byte-limit.validator.ts`). That decorator counts UTF-8 bytes,
  which `@MaxLength` cannot do, and bcrypt ignores each byte after the 72nd. A DTO field that only
  **verifies** a password keeps `MAX_PASSWORD_LENGTH`, which is 128: the stored hash covers the same
  truncated prefix, thus a lower cap there locks out the owner of a long legacy password and makes
  no hash safer.

  Note that `PERMISSIONS` and `Permission` are gone. The code uses a typed `[Actions, Subjects]`
  tuple instead.
- **Utils.** `@app/shared/utils/time` is the single import site. It re-exports `Temporal` from the
  `temporal-polyfill` package, which the project pins exactly until the native Temporal API ships.

  `@app/shared/utils/money` holds `Money`. That is a BigInt value object over integer minor units.
  Its `toNumber()` method has an overflow guard for the JSON wire. There is no floating-point
  arithmetic.

  `@app/shared/utils/cursor` holds `encodeCursor` and `parseCursor`. That is the token codec of the
  keyset pagination, and the mock server shares it. `common/utils/cursor.util.ts` wraps `parseCursor`
  and raises a `BadRequestException` on a malformed token.

The NestJS build compiles the shared files into `dist/shared/`, beside `dist/server/`. Thus a
migration script and a seed script use a path such as `dist/server/src/...`, which reflects the
nested output structure.

## Versioning

`commit-and-tag-version` keeps the version of this package equal to the version of `client/` and
`mock-server/`. To make a release, run `npm run release` from `client/`. That command increases the
version in `server/package.json` automatically.

## Tech Stack

| Technology | Version |
|------------|---------|
| NestJS | 11.2.1 |
| TypeORM | 0.3.31 |
| PostgreSQL | through `pg` 8.23.0 |
| Passport | 0.7.0 |
| bcrypt | 6.0.0 |
| class-validator | 0.14.4 |
| @nestjs/swagger | 11.4.7 |
| @nestjs/schedule | 6.1.3 |
| cache-manager | 6.4.3 |
| @keyv/redis | 5.1.6 |
| ioredis | 5.11.1 |
| TypeScript | 5.9.3 |
| Jest | 30.4.2 |
| ESLint | 9.39.5 |
| Prettier | 3.9.6 |
