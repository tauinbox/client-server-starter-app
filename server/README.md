# Server

NestJS 11 REST API with JWT authentication, PostgreSQL via TypeORM, and Swagger documentation.

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

`server/docker-compose.yml` is the local **dev** stack — Postgres (`:5432`),
Redis (`:6379`), and Mailpit (SMTP `:1025`, UI `:8025`). It is separate from the
repo-root `docker-compose.yml`, which is the **production** deployment file and
should not be run locally. Redis and Mailpit are optional: set `REDIS_URL` to
enable the queue/cache, and `SMTP_HOST`/`SMTP_PORT` to capture mail in Mailpit
(see [Email](#email-mailmodule)).

**Alternative for development**: Use the mock-server (no database required):

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
| Lint | `npm run lint` |
| Lint fix | `npm run lint:fix` |
| Format check | `npm run format:check` |
| Format | `npm run format` |
| Unit tests | `npm test` |
| Single test | `npx jest --testPathPattern=<pattern>` |
| Test watch | `npm run test:watch` |
| Test coverage | `npm run test:cov` |
| E2E tests | `npm run test:e2e` |
| Run migrations | `npm run migrations:run` (build first) |
| Generate migration | `npm run migrations:gen -- ./src/migrations/<kebab-name>` (build first) |
| Revert migration | `npm run migrations:revert` (build first) |
| Run seeders | `npm run seed:run` (build first) |
| Validate i18n keys | `npm run check:i18n` — verifies all `ErrorKeys` values exist in every client i18n JSON |
| Generate CASL subjects | `npm run generate:subjects` — scans `@RegisterResource` decorators and writes `shared/src/generated/casl-subjects.ts`; run when adding a new resource |
| Audit role-permission conditions | `npm run check:role-conditions` — flags any `role_permissions.conditions.custom` rows that contain operators or fields the SQL translator (`apply-ability.util.ts`) cannot handle. Run against staging dumps before deploying changes to the translator. |
| Audit dependencies | `npm run audit:ci` — runs `npm audit --audit-level=high --omit=dev`, the same gate CI enforces. Fails on high/critical advisories; moderate findings pass. Run before every push (advisories are tree-based, so this can fail with no source change). |

## Environment Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Default | Description |
|----------|---------|-------------|
| `APPLICATION_PORT` | `3000` | HTTP listen port |
| `ENVIRONMENT` | `local` | Environment name (`local` enables auto-sync & permissive CORS) |
| `SWAGGER_ENABLED` | - | Set to `true` to enable Swagger UI in staging/production (always on in `local`/`development`) |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `my-db` | Database name |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | `password` | Database password |
| `DB_SCHEMA` | `public` | Database schema |
| `DB_LOGGING` | `["warn","error","slow"]` | TypeORM logging levels. `"slow"` logs queries exceeding `DB_SLOW_QUERY_THRESHOLD` |
| `DB_SLOW_QUERY_THRESHOLD` | `200` | Slow query threshold in milliseconds |
| `DB_LOGGER` | - | TypeORM logger type (e.g. `advanced-console`, `file`); overrides the default logger when set |
| `REQUEST_LOG_LEVEL` | `all` | Request logging verbosity: `all` (every request), `warn` (4xx+5xx only), `error` (5xx only) |
| `JWT_ALGORITHM` | `RS256` | Signing algorithm: `HS256` (symmetric) or `RS256` (asymmetric) |
| `JWT_SECRET` | - | Symmetric secret, min 16 chars (required when `JWT_ALGORITHM=HS256`) |
| `JWT_PRIVATE_KEY` | - | Base64-encoded RSA private key PEM (required when `JWT_ALGORITHM=RS256`) |
| `JWT_PUBLIC_KEY` | - | Base64-encoded RSA public key PEM (required when `JWT_ALGORITHM=RS256`) |
| `JWT_MIN_IAT` | - | Unix timestamp; tokens issued before this value are rejected (used during key rotation) |
| `JWT_EXPIRATION` | `3600` | Access token lifetime in seconds (1h) |
| `JWT_REFRESH_EXPIRATION` | `604800` | Refresh token lifetime in seconds (7d) |
| `GOOGLE_CLIENT_ID` | - | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | - | Google OAuth client secret |
| `FACEBOOK_CLIENT_ID` | - | Facebook OAuth client ID |
| `FACEBOOK_CLIENT_SECRET` | - | Facebook OAuth client secret |
| `VK_CLIENT_ID` | - | VK OAuth client ID |
| `VK_CLIENT_SECRET` | - | VK OAuth client secret |
| `CLIENT_URL` | `http://localhost:4200` | Client URL for OAuth callback redirects |
| `ADMIN_EMAIL` | - | Email for the initial admin user (created on startup if not exists; skip if empty) |
| `ADMIN_PASSWORD` | - | Password for the initial admin user |
| `ADMIN_FIRST_NAME` | `Admin` | First name for the initial admin user |
| `ADMIN_LAST_NAME` | `User` | Last name for the initial admin user |
| `SMTP_HOST` | - | SMTP server host (if unset, emails logged to console) |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_SECURE` | - | `true` forces implicit TLS; unset = STARTTLS on 587, implicit TLS on 465 (TLS always required) |
| `SMTP_USER` | - | SMTP username |
| `SMTP_PASS` | - | SMTP password |
| `SMTP_FROM` | `noreply@example.com` | Sender email address |
| `REDIS_URL` | - | Redis connection URL (optional; enables distributed rate limiting and shared permission cache for multi-instance deployments) |
| `AUDIT_LOG_RETENTION_DAYS` | `90` | Days to retain audit log entries before nightly deletion |
| `TURNSTILE_SITE_KEY` | - | Cloudflare Turnstile site key (public). Both Turnstile keys must be set to enable CAPTCHA; see [Enabling CAPTCHA in production](#enabling-captcha-in-production) |
| `TURNSTILE_SECRET_KEY` | - | Cloudflare Turnstile secret key. CAPTCHA stays disabled while either key is empty |
| `DB_POOL_MAX` | `10` | Maximum PostgreSQL connection pool size |
| `DB_POOL_IDLE_TIMEOUT` | `30000` | Milliseconds before an idle connection is closed |
| `DB_POOL_CONNECTION_TIMEOUT` | `5000` | Milliseconds to wait for a connection before erroring |
| `CORS_ORIGINS` | - | Comma-separated allowed origins (e.g. `https://app.example.com,https://admin.example.com`); `*` is rejected in production |
| `TRUSTED_PROXIES` | - (local), `loopback,uniquelocal` (docker-compose) | Express `trust proxy` setting. Required behind a reverse proxy so `req.ip` resolves to the real client (see [Deployment behind a reverse proxy](#deployment-behind-a-reverse-proxy)). Accepts `loopback` / `linklocal` / `uniquelocal`, a comma-separated IP/CIDR list, a hop count (e.g. `1`), or `true`. The application has no built-in default — leave the env var empty to disable. The repo's `docker-compose.yml` overrides this to `loopback,uniquelocal` for prod deployments behind a host-local reverse proxy or a docker-bridge sidecar; export `TRUSTED_PROXIES` in the shell to override. |
| `PADDLE_API_KEY` | - | Paddle server API key. Paired with `PADDLE_WEBHOOK_SECRET`; both must be set for Paddle to count as configured |
| `PADDLE_WEBHOOK_SECRET` | - | Paddle webhook HMAC secret for signature verification |
| `PADDLE_ENVIRONMENT` | `sandbox` | Paddle API host: `sandbox` or `production` |
| `YOOKASSA_SHOP_ID` | - | YooKassa shop ID. Paired with `YOOKASSA_SECRET_KEY`; both must be set for YooKassa to count as configured |
| `YOOKASSA_SECRET_KEY` | - | YooKassa secret key |
| `YOOKASSA_VAT_CODE` | `1` | VAT code on every 54-FZ receipt line (1–6, tax-regime specific; `1` = "без НДС") |
| `BILLING_DEFAULT_CURRENCY` | `USD` | Default billing currency for new customers (`USD` or `RUB`). Billing UI stays hidden until at least one provider is configured |
| `BILLING_WEBHOOK_IP_ALLOWLIST` | - (local), provider egress ranges (docker-compose) | Comma-separated IPs/CIDRs allowed to call `/billing/webhooks/*`; other sources get `403` before any webhook processing. Empty disables the check; a malformed entry fails startup. Requires `TRUSTED_PROXIES` behind a reverse proxy. See [Billing webhook source-IP allowlist](#billing-webhook-source-ip-allowlist) |

## Architecture

### Module Structure

```
src/
├── common/
│   ├── dtos/               # PaginationQueryDto, PaginatedResponseDto<T>, CursorPaginationQueryDto, CursorPaginatedResponseDto<T>
│   ├── utils/              # Shared utilities (escapeLikePattern, hashToken, withTransaction, extractAuditContext, cursor encode/decode, applyKeysetPagination)
│   └── upload/             # createDiskStorageOptions() — reusable multer disk storage factory (destination, allowedExtensions, maxFileSizeBytes); validates both file extension and MIME type to block rename attacks
└── modules/
├── core/                   # Dynamic root module
│   ├── config/             # @nestjs/config, loads .env
│   ├── cache/              # @nestjs/cache-manager
│   ├── database/           # TypeORM + PostgreSQL config
│   ├── filters/            # GlobalExceptionFilter (standardized error responses, DB error mapping)
│   ├── health/             # HealthModule (GET /api/health/live, /api/health/ready — DB ping + Redis PING when REDIS_URL set or production;
│   │                       #   dead Redis fails readiness (2 s timeout), missing REDIS_URL in production and SMTP failures degrade to a warning)
│   ├── metrics/            # MetricsModule (@Global) — Prometheus metrics via @willsoto/nestjs-prometheus
│   │                       #   GET /metrics (excluded from /api prefix); http_requests_total,
│   │                       #   http_request_duration_seconds, auth_events_total,
│   │                       #   rbac_permission_denied_total{action,subject,level},
│   │                       #   mail_queue_jobs{state}, mail_jobs_processed_total{outcome},
│   │                       #   db_pool_connections{state}, cache_requests_total{cache,outcome};
│   │                       #   HttpMetricsInterceptor
│   └── schedule/           # @nestjs/schedule for cron jobs
├── auth/
│   ├── controllers/        # AuthController (includes GET /permissions), OAuthController, RbacController
│   ├── services/           # AuthService, OAuthService, TokenGeneratorService, RefreshTokenService, OAuthAccountService, TokenCleanupService, ResourceService, ActionService, ResourceSyncService
│   ├── strategies/         # LocalStrategy, JwtStrategy (extracts roles), GoogleStrategy, FacebookStrategy, VkStrategy
│   ├── guards/             # LocalAuthGuard, JwtAuthGuard, Google/Facebook/VkOAuthGuard (via createOAuthProviderGuard factory)
│   ├── entities/           # RefreshToken, OAuthAccount, Resource, Action
│   ├── enums/              # OAuthProvider
│   └── dto/                # LoginDto, RegisterDto, UpdateProfileDto, VerifyEmailDto, ForgotPasswordDto, ResetPasswordDto
├── audit/
│   ├── audit.service.ts         # AuditService — records 20 security-sensitive actions to audit_logs table
│   ├── audit-cleanup.service.ts # AuditCleanupService — nightly cron deletes entries older than AUDIT_LOG_RETENTION_DAYS days
│   ├── decorators/              # @LogAudit({action,targetType,targetIdParam?,targetIdFromResponse?,details?}) declarative audit logging
│   ├── interceptors/            # AuditLogInterceptor — global APP_INTERCEPTOR reads @LogAudit metadata and fires logFireAndForget after success
│   └── entities/                # AuditLog entity (action, actorId, actorEmail, targetId, ip, requestId, createdAt)
├── mail/
│   └── mail.service.ts     # Email sending (verification, password reset)
├── roles/
│   ├── controllers/        # RolesController (CRUD + permission + user assignment at /api/v1/roles)
│   ├── services/           # RoleService, PermissionService, PolicyEvaluatorService
│   ├── entities/           # Role, Permission, RolePermission
│   ├── guards/             # PermissionsGuard (resolves + checks typed permissions; admin bypasses)
│   ├── decorators/         # @RequirePermissions([Actions,Subjects]), @Authorize([action,subject]) composite, @RegisterResource
│   └── casl/               # app-ability.ts (AppAbility, Actions, Subjects, PermissionCheck types)
│                           # CaslAbilityFactory (builds AppAbility, used by AuthController /permissions)
├── notifications/
│   ├── notifications.service.ts    # Manages Map<userId, Map<connectionId, Subject>> — push(userId), pushToAll()
│   ├── notifications.listener.ts   # @OnEvent() handlers: UserDeleted/PasswordChanged/Created/Updated/Restored/RoleChanged/RolePermissionsChanged → push
│   └── notifications.controller.ts # GET /stream — @Sse() returns Observable<MessageEvent> merged with 30s heartbeat
├── feature-flags/
│   ├── feature-flags.module.ts        # TypeOrmModule.forFeature([FeatureFlag, FeatureFlagRule]); registers AnonIdMiddleware globally via configure()
│   ├── entities/                       # FeatureFlag + FeatureFlagRule (cascade) with entity-contract files
│   ├── services/feature-flag.service.ts          # CRUD + optimistic-lock 409 on PATCH (If-Match); replaceRules in single tx
│   ├── services/feature-flag-resolver.service.ts # Cached evaluation; per-user keys suffixed with featureflags:version counter so flag changes orphan all per-user entries without Redis SCAN
│   ├── services/attribute-registry.service.ts    # Extensibility seam — registerAttribute(key, resolver) from other modules' onModuleInit
│   ├── controllers/feature-flags-admin.controller.ts # 7 admin endpoints under /admin/feature-flags; @Authorize(['manage','FeatureFlag']) + @LogAudit
│   ├── controllers/feature-flags.controller.ts       # GET /feature-flags — @OptionalAuth(); authenticated → flags resolving true + public flags (disabled non-public omitted); anon → public flags only
│   ├── decorators/require-feature.decorator.ts       # @RequireFeature('key') convenience — RBAC remains the real gate
│   ├── guards/feature-flag.guard.ts                  # Returns 404 (anti-enumeration) when the named flag is disabled for the caller
│   ├── middleware/anon-id.middleware.ts              # Issues nxs_anon_id cookie (SameSite=Lax, Secure in prod, 1yr, httpOnly=false) on first request
│   ├── events/feature-flag-changed.event.ts          # { flagKey, changeType: 'created'|'updated'|'deleted'|'toggled'|'rules-replaced' }
│   ├── listeners/feature-flag-changed.listener.ts    # Invalidates cache + bumps version + pushToAll SSE on FeatureFlagChangedEvent; per-user invalidation on UserRoleChangedEvent / UserDeletedEvent
│   └── utils/validate-rule-payload.util.ts           # Discriminated payload validation per rule type; rejects custom attribute keys not in the registry
├── billing/                # Subscriptions/billing foundation (BillingModule.forRoot() in CoreModule.forRoot())
│   ├── billing.module.ts   # forRoot() dynamic module: FeatureFlagsModule + TypeOrmModule.forFeature([CreditBalance, CreditLedger, Customer, CustomerGrant, Plan, Product, Subscription, Invoice, PaymentMethod, UsageRecord, WebhookEvent, User (read-only, for YooKassa 54-FZ receipt email)]); BILLING_PROVIDERS + PADDLE_CLIENT + YOOKASSA_CLIENT factories; registers the billing-webhook BullMQ queue + processor + WebhookReconciliationService when REDIS_URL is set (the processor also self-schedules a repeatable reconciliation sweep on bootstrap, skipped under test), and the self-managed renewal queue + processor when REDIS_URL is set and not under test (the renewal scan self-schedules on bootstrap); exports BillingService + EntitlementService + EntitlementGuard + UsageService + CreditService
│   ├── billing.service.ts  # resolveProvider() geo-router: providerOverride ?? geoDefault(country); 503 when provider disabled/unconfigured; geoDefaultFor()/effectiveProviderId()/getProviderById() helpers
│   ├── controllers/        # BillingPlansController — @Public() GET /api/v1/billing/plans (active plans, per-provider prices); BillingUserController — JWT, all scoped to req.user (IDOR-safe): GET subscription|invoices|payment-method, GET usage (current-period metered-usage summary for the caller's usage-mode subscription, null otherwise), POST checkout (creates the local incomplete subscription for the self-managed provider, then redirects), POST subscription/change (instant prorated plan/mode switch) + subscription/change/preview (cost without applying), POST subscription/cancel (period-end default), POST payment-method (provider-hosted card replacement: Paddle payment-method-change checkout / YooKassa zero-amount re-bind whose webhook swaps the default; past_due allowed — dunning recovery), GET/PUT region (auto/ru/world override + active-subscription guard, §19), GET products (one-time catalog: active products carrying a price entry for the effective provider — fixed-price sku/credits plus custom entries whose price holds the donation amount bounds; resolved without the availability assertion, so the catalog stays browsable), POST purchase (one-time purchase on the resolved provider: server price-authoritative for fixed-price products, custom amounts validated against the product's min/max bounds, buyer note sanitized into the receipt), GET credits (the caller's prepaid credit balance, null until a pack is bought), GET premium-content (worked @RequireEntitlement('reports') example); BillingAdminController — CASL manage Billing (@RegisterResource Billing): GET subscriptions|invoices, POST subscriptions/:id/cancel, POST invoices/:id/refund (refunds are tracked cumulatively in `refunded_minor` and cannot exceed `amount_minor`; once cumulative refunds reach the total the invoice flips to `refunded`, revokes a one-time sku's CustomerGrant + drops the buyer's cached entitlements, and claws a credit pack's units back — balance may go negative, blocking usage until topped up; a refund leaving a remaining balance keeps grant and credits), POST usage (internal metering ingest, idempotent on idempotency_key — no public meter endpoint)
│   ├── services/           # PlanService — findActive(); BillingUserService — customer get-or-create (geo from registration locale), checkout, cancel, usage summary (UsageRating over the current period), region read/set with the no-cross-provider-migration guard, one-time catalog (listProducts) + purchase (resolveProvider → createOneTimePayment with the product id round-tripped through custom data; { provider, url|null, sessionRef } back to the client), payment-method update start (dispatched on the subscription's provider like cancel; returns the hosted session, return URL = billing settings), plan change + proration preview (serialized by an optimistic `version` compare-and-swap on the subscription before any money moves — a concurrent change loses the CAS and is rejected 409, so the provider is never asked for a second conflicting charge, and the CAS stays out of the DB transaction so no row lock is held across the provider HTTP call; Paddle delegates with the new plan key re-planted in custom data; YooKassa charges the prorated new plan FIRST — a declined card aborts the switch — then refunds the outgoing plan's remainder against the invoice that paid for its current coverage [resolved BEFORE the new charge is recorded, so the charge can't refund itself], capped by that invoice's unrefunded remainder and recorded on its refunded_minor; both invoice legs + the plan apply commit in ONE transaction [no charged-but-unapplied window], each leg keyed by a unique change-{charge,refund} event id; trial switches move no money; guarded to active/trialing, no scheduled cancel, same-provider price required); BillingAdminService — cross-customer read + cancel/refund (full credit-pack refund → CreditService clawback); UsageService — idempotent metering ingest (record() resolves the active subscription, dedups on the unique idempotency_key incl. a unique-violation race guard; 409 while the credit balance is negative); CreditService — single owner of the prepaid balance: atomic upsert (balance += delta, no read-modify-write) + append-only CreditLedger entry per change (purchase/usage/refund), mutators join the caller's invoice transaction so exactly-once rides on the winning provider_event_id insert; UsageInvoicingService — invoices a closed usage period of a provider-managed (Paddle) subscription postpaid: reads and rates the prepaid credit balance under a FOR UPDATE row lock so concurrent closes for the same customer serialize and never over-apply credits, plants a pending Invoice keyed by the unique usage:{subscriptionId}:{periodEnd} BEFORE posting the provider charge and spends the applied credits in the same transaction (a raced/replayed close loses the insert → never double-charges or double-spends; a zero net charge — no usage or credits cover it all — settles as a paid zero invoice without a provider call)
│   ├── entities/           # 11 entities (Plan, Customer, CustomerGrant, CreditBalance, CreditLedger, PaymentMethod, Product, Subscription, Invoice, UsageRecord, WebhookEvent) + entity-contract + serialization specs
│   ├── dtos/               # response DTOs (subscription/invoice/payment-method/checkout-session/region/usage/usage-summary/proration-preview/product/customer-grant/credit-balance/purchase-session) with WireType/StructuralDiff contract checks + checkout/change/cancel/region/refund/record-usage/purchase request DTOs
│   ├── entitlements/       # EntitlementService.capabilitiesFor(userId) (active/trialing/past_due-in-grace → plan.entitlements, else Free, unioned with active CustomerGrants — non-revoked, non-expired — from paid one-time sku purchases), monotonic-version per-user cache; @RequireEntitlement('<cap>') decorator + EntitlementGuard (403)
│   ├── events/             # billing.events.ts — SubscriptionActivated/Renewed/PastDue/Canceled, PlanChanged, InvoicePaid, PaymentFailed (each carries userId); UsagePeriodClosed (provider-managed usage rollover → usage-invoicing listener)
│   ├── listeners/          # entitlement-cache.listener (invalidate user on any entitlement-changing event) + billing-user-deleted.listener (on UserDeletedEvent: cancel provider-managed subscriptions at the provider, cancel self-managed ones locally + emit SubscriptionCanceledEvent; best-effort)
│   ├── providers/          # PaymentProvider interface + NormalizedEvent behind the BILLING_PROVIDERS token; PaddleProvider (real: webhooks.unmarshal HMAC verify → NormalizedEvent incl. the usage charge key echoed via price custom data, startCheckout, chargeUsage = createOneTimeCharge at the cycle boundary, createOneTimePayment = transactions.create (catalog paddlePriceId or inline non-catalog price for custom amounts; one-time marker + productId in custom data; url optional — Paddle.js can complete by txn id), changePlan/previewChangePlan = subscriptions.update/previewUpdate with prorated_immediately, updatePaymentMethod = getPaymentMethodChangeTransaction hosted checkout [its zero-amount completed/failed webhooks are dropped by origin], cancel, refund [the Paddle API has no client idempotency keys, so the caller's refund key is embedded in the adjustment reason and a retry finds the existing adjustment via adjustments.list and no-ops — no double refund]) + YooKassaProvider (real, self-managed: startCheckout = createPayment save_payment_method + redirect [zero-amount binding for trials], chargeOffSession via the saved PaymentMethod token with 54-FZ receipt + Idempotence-Key (reports `captured` only for a `succeeded` payment; a payment-after-receipt `pending`/`waiting_for_capture` is reported uncaptured so the core records it pending rather than granting the period, `canceled` throws), findOffSessionCharge = metadata scan of getPaymentList reporting the same captured/pending status, createOneTimePayment = plain createPayment with receipt + redirect tagged purpose:one_time (card NOT saved), updatePaymentMethod = zero-amount re-bind tagged purpose:method_update [success webhook → payment_method.updated; abandoned re-bind ignored], refund with refund receipt, verifyAndParseWebhook = GET-refetch by id → NormalizedEvent; cancel is a no-op); {paddle,yookassa}.client.ts build each SDK from env or null when unconfigured
│   ├── rating/             # RatingStrategy interface + FixedRating (plan price) + UsageRating (sums UsageRecords with occurred_at in [period start, end), charges the overage beyond includedUnits at unitPriceMinor; summarizeForPeriod() backs GET /billing/usage, summarizeForPeriodWithCredits() backs both providers' usage invoicing — prepaid credits offset billable units one-for-one before pricing, the caller deducts the applied units) + ProrationCalculator (self-managed plan-change split: whole-day remainder, refund old / charge new, §17.4)
│   ├── renewals/           # RenewalService — self-managed (YooKassa) renewal loop (design §8.2): sweeps due subscriptions of BOTH rating modes, skipping subscriptions whose owning user is soft-deleted (joins billing_customers -> users) (fixed prepays the next period; usage postpays the closed one — rated over [currentPeriodStart, anchor) with prepaid credits applied first, invoice covers that period, a zero net charge advances via a zero invoice without a provider call, applied credits are spent inside the period-advance transaction), off-session charge under an Idempotence-Key stable per (subscription, period) — `renewal:{subId}:{anchorMs}`, also the renewal invoice's unique provider_event_id — so a dunning retry reconciles the prior attempt via findOffSessionCharge instead of charging twice; an accepted-but-uncaptured (`pending`) charge is recorded as a pending invoice with NO period advance and is resolved by the confirming webhook or the next scan's poll (captured → settle + advance; canceled at capture → failed + dunning), with the advance a compare-and-swap on the period end read at scan start so it runs exactly once; advances the period / converts trials, and walks dunning (3 attempts over a ~7-day grace → past_due → canceled; entitlements kept through grace); RenewalProcessor = BullMQ repeatable scan upserted on bootstrap (multi-instance safe)
│   ├── webhooks/           # @Public() POST webhooks/{paddle,yookassa} (RawBodyRequest) → WebhookIngestionService: verify via provider seam, idempotent insert on unique (provider, provider_event_id) persisting the verified NormalizedEvent on the row, enqueue reduction on BullMQ (inline without Redis); dedup is status-aware — a delivery is a permanent no-op only once it reaches `processed`, a row still `received` (a reduce that threw or a worker that died) is reprocessed on the next redelivery rather than dropped, and a periodic WebhookReconciliationService sweep replays rows stuck in `received` past a threshold from the persisted event (provider-independent recovery for the queued path); BillingEventReducer applies the NormalizedEvent onto Subscription/Invoice in a transaction (idempotent), stamps the row with event.provider + the derived lifecycle owner (Paddle = provider, YooKassa = self), and emits the matching domain event. On the self-managed (YooKassa) first-payment path it also persists the saved card as the customer's default PaymentMethod, points the incomplete subscription (found by customer id) at it, and flips it to active/trialing. A payment_method.updated event (method-update re-bind) swaps the default card instead: the old method is demoted (kept for history), the customer's autopay pointer and the open subscription move to the new row — no invoice, no status change. For a provider-managed usage subscription it detects the period rollover (incoming snapshot starts at/after the stored boundary) and emits UsagePeriodClosed after commit; a paid/failed webhook carrying the usage charge key settles/fails the matching pending usage invoice instead of inserting a new row. A webhook carrying an off-session charge key never inserts (the core already recorded that invoice): a succeeded one settles a still-pending row (status-gated pending → paid + paid_at + ref, spending the credit units the charge was rated against) and emits InvoicePaid, or reconciles only the ref if already settled; a canceled one (a pending charge declined at capture) flips the pending row to failed silently — the renewal scan observes it and owns the dunning ladder. A paid one-time purchase (kind one_time + productId echoed via custom data/metadata) reduces onto a kind 'one_time' invoice (subscription_id NULL, product_id) and applies the product's effect once per paid invoice — sku → CustomerGrant (expiry from grant.durationDays, else permanent), credits → prepaid balance top-up + ledger entry, custom → no grant; it never links/activates a subscription or saves a card, and a failed/canceled one-time payment is dropped (nothing pending locally, no dunning signal)
│   ├── config/             # BillingConfigService — env-derived paddle/yookassa "configured" booleans
│   └── registrars/         # BillingConfiguredAttributesRegistrar — registers paddleConfigured/yookassaConfigured + combined billingConfigured feature-flag attributes; public `billing` flag gates the UI on configuration, per-provider billing.provider.*.enabled admin kill-switches gate the geo-router
└── users/
    ├── controllers/        # UsersController (CRUD + search, all endpoints use @Authorize([action, 'User']))
    ├── services/           # UsersService
    ├── entities/           # User entity (ManyToMany to Role via user_roles)
    └── dto/                # CreateUserDto, UpdateUserDto, UserResponseDto (public; roles: RoleResponse[])
                            # AdminUserResponseDto extends UserResponseDto + lockedUntil + roles: RoleAdminResponseDto[]
```

### Request Pipeline

```
Request → Global Middleware (Compression, CookieParser, CORS)
        → Module Middleware
        → Guards (JwtAuthGuard, RolesGuard)
        → Interceptors (ClassSerializer with @SerializeOptions, custom)
        → Pipes (ValidationPipe, custom)
        → Controller Handler
        → Interceptors (response phase)
        → Response

On exception: GlobalExceptionFilter catches all errors and returns
standardized error responses with timestamp, path, and user-friendly messages.
TypeORM errors are mapped by PG error code. Unknown errors return generic 500.
```

### Authentication

- **LocalStrategy** — validates email/password via bcrypt on login
- **JwtStrategy** — verifies Bearer-token signature, enforces `JWT_MIN_IAT` and per-user `tokenRevokedAt` cutoffs, returns `PayloadFromJwt` (`{ userId, email, roles }`) — no `isAdmin` flag
- **GoogleStrategy / FacebookStrategy / VkStrategy** — OAuth2 login (conditionally registered when env vars are set)
- **Secure-by-default routing** — `JwtAuthGuard` is registered globally via `APP_GUARD` in `CoreModule`. Every endpoint requires a valid Bearer token unless explicitly opted out with `@Public()` (handler- or controller-level). Forgetting to mark a new endpoint protects it by default — the `check-auth-coverage` e2e suite iterates the per-feature route manifests under `contracts/routes/` to enforce this.
- **@Public() decorator** — opt-out marker for endpoints intentionally reachable without authentication (login, register, password reset, OAuth init/callback, health, `/metrics`)
- **@OptionalAuth() decorator** — variant of `@Public()` that still invokes `JwtStrategy.validate()` when a Bearer token is present so the handler receives a populated `req.user`, but never rejects on missing / invalid / expired / revoked tokens. Used by `GET /feature-flags` so the same endpoint can serve both anonymous browsers (public flags only) and authenticated users (full role / userId / email-attribute rule evaluation). `@OptionalAuth()` and `@Public()` must not be combined on the same handler; if both are set, `@Public()` wins (skips the strategy entirely)
- **PermissionsGuard** — resolves user permissions (cached 5 min), checks required permissions from typed `@RequirePermissions([Actions, Subjects])`; roles with `isSuper` flag bypass all checks
- **@Authorize([action, subject]) decorator** — composite: `JwtAuthGuard` + `PermissionsGuard` + typed `@RequirePermissions()`. Replaces `@UseGuards(JwtAuthGuard, RolesGuard) @Roles()` pattern
- **CaslAbilityFactory** — builds `AppAbility` from user roles + permissions; used by `AuthController` to return CASL packed rules via `packRules()` from `GET /permissions`. Partitions rules allow-first / deny-last so permissions with `conditions.effect === 'deny'` register as CASL `cannot()` rules and reliably override prior allows for the same `(resource, action)` pair. Conditions are fail-closed: when `resolveConditions()` vetoes a permission (malformed branch shape per the shared `permission-condition-shape.ts` finders — non-array/empty-array `fieldMatch` values, non-string `userAttr` attributes, invalid `ownership.userField`, prototype-pollution keys; an unknown `userAttr` attribute; denied/invalid/non-object `custom` JSON; or restriction branches that resolve to an empty query), an `allow` registers nothing and a `deny` registers as an unconditional `cannot()`; partial resolution is never registered — dropping just the malformed fragment would silently widen the authored restriction. Only a branch-less condition (bare `effect`) registers unconditionally. The same shape rules are enforced at input by `PermissionConditionDto` (custom validators in `common/validators/permission-condition-shape.validator.ts`), so a partially malformed condition is rejected with 400 at authoring time
- **Instance-level enforcement** — every single-entity endpoint (`GET/PATCH/DELETE /users/:id`, `GET /users/:id/permissions`, `GET/PATCH/DELETE /roles/:id`, `GET /roles/:id/permissions`, `PATCH/POST(restore) /rbac/resources/:id`, `PATCH/DELETE /rbac/actions/:id`) loads the target record and runs `assertCan(ability, action, subject(<Subject>, entity))` BEFORE returning or mutating. This blocks the type-level `@Authorize` bypass that would otherwise let an admin-configured conditional grant become unconditional on a single-entity route. `UsersService.update/remove/restore` and `RoleService.assignRoleToUser/removeRoleFromUser` apply the same check in the service layer; super-role assignment/removal is blocked for non-super actors. Each denial emits a `PERMISSION_CHECK_FAILURE` audit row (`details.instanceCheck === true`) and increments `rbac_permission_denied_total{level="instance"}`.
- **JWT payload** — `CustomJwtPayload` carries `email` and optional `roles: string[]` on top of the standard `JwtPayload` claims; access decisions go through CASL/RBAC, not the payload
- **Field-level response gating** — `class-transformer` decorators on entities determine wire shape: `@Exclude()` always hides (e.g. `User.password`, `User.failedLoginAttempts`), `@Expose({ groups: ['privileged'] })` hides by default and surfaces only on controllers with `@SerializeOptions({ groups: ['privileged'] })` (e.g. `User.lockedUntil`, `Role.isSystem`, `Role.isSuper`). Authorization (`@Authorize`) decides who can call the endpoint; serialization decides what fields the authorized caller sees. Self/auth endpoints (`AuthController`) carry no group → public form; admin endpoints (`UsersController`, `RolesController`) carry the `privileged` group → admin form
- **Refresh tokens** — opaque 80-char hex tokens stored in DB (SHA-256 hashed), delivered to the client as an `HttpOnly SameSite=Strict` cookie (`path=/api/v1/auth`), rotated on every use; never appear in response body. **Reuse detection** (OAuth 2.0 BCP / RFC 6819): if `refreshTokens()` sees a token where `revoked === true && !isExpired()`, every refresh token for the user is deleted and `User.tokenRevokedAt` is stamped — invalidating live access tokens too. A `TOKEN_REUSE_DETECTED` audit row is written and `auth_events_total{event="token_reuse_detected"}` increments. Revoked-and-expired tokens fall through to the standard 401 (natural cleanup window)
- **OAuth accounts** — manage linked providers, safety check on unlink. **Auto-link disabled**: if a local account already exists for the OAuth-asserted email, the callback throws `OAUTH_EMAIL_ALREADY_REGISTERED` (409) and redirects to `/login?oauth_error=email_already_registered`; users must log in with their password and link the provider explicitly via `POST /auth/oauth/link-init`. New users created via OAuth use the provider's `email_verified` flag (`profile.emails[0].verified` for Google, `profile._json.verified` for Facebook, always `false` for VK)
- **Token cleanup** — daily cron removes expired tokens, weekly cron removes revoked+expired
- **Account lockout** — 5 failed login attempts → 15 min lock (HTTP 423), admin unlock via user update
- **Email verification** — required before login, 24-hour token expiry, resend capability. OAuth users created with `isEmailVerified=true` only when the provider asserts the email is verified; otherwise a verification email is sent at signup (same flow as local registration). Admin email changes via `PATCH /api/v1/users/:id` reset `isEmailVerified` to false, issue a new hashed token, and dispatch a verification email; uniqueness is enforced server-side (HTTP 409 with `errorKey: errors.users.emailExists` and `field: 'email'`)
- **Self-service email change** — two-step confirm-to-new flow: `POST /api/v1/auth/profile/email/initiate` stores a hashed token + new address on the user row (1-hour expiry) and sends a confirmation link to the new address plus a no-link masked alert to the old address; `POST /api/v1/auth/profile/email/confirm` applies the change inside a transaction, re-checks uniqueness for the race window, revokes all refresh tokens, and notifies the old address. OAuth-only accounts (no password) are rejected — they must set a password first. The endpoint is throttled (3/hour), enumeration-safe (same response shape on taken-address conflict), and clears the in-flight `pendingEmail*` fields on `resetPassword`, admin email change, soft-delete, and `UserDeletedEvent`. A partial unique index on `LOWER(pending_email)` and dual-email checks on `register`/`users.create`/`users.update` keep `{email} ∪ {pendingEmail}` globally unique even under concurrent writes
- **Password reset** — forgot-password/reset-password flow, 30-minute token expiry, invalidates all sessions
- **CAPTCHA soft-trigger** — `CaptchaRequiredGuard` gates `/register` and `/forgot-password` with a Cloudflare Turnstile challenge that activates only when `X-RateLimit-Remaining ≤ 1` for the caller's IP. **Disabled by default** (both env vars empty). Production activation requires a free Cloudflare account; full step-by-step in [Enabling CAPTCHA in production](#enabling-captcha-in-production). Test keys (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`) work for local dev and CI but are **public — zero protection in production**.

### Email (MailModule)

- Uses `nodemailer` for sending verification, password reset, and email-change messages
- **SMTP transport** when `SMTP_HOST` env var is set — STARTTLS is enforced on port 587 **when credentials are configured** (`requireTLS`, so a downgrade aborts instead of leaking them); implicit TLS on 465 or when `SMTP_SECURE=true`; `minVersion: TLSv1.2` with certificate validation kept on. An unauthenticated local sink (e.g. Mailpit, which has no credentials and no STARTTLS) is exempt so plaintext dev delivery still works
- **Console transport** when `SMTP_HOST` is not set — logs clickable URLs
- Email links use `CLIENT_URL` env var: `${clientUrl}/verify-email?token=xxx`, `${clientUrl}/reset-password?token=xxx`
- **Async delivery**: when `REDIS_URL` is set, messages are rendered then enqueued on a BullMQ queue (`mail`) and delivered by `MailProcessor` with retries (3 attempts, exponential backoff). Without `REDIS_URL`, `MailService` delivers inline in the request (no retries). The queue is transparent to callers — `MailService.sendXxx(...)` is unchanged. Mail is best-effort on both paths: an enqueue failure (e.g. Redis outage) or an inline delivery failure is logged and never propagates to the caller.
- **Delivery test**: `test/email-delivery.e2e-spec.ts` boots the full app and verifies register → email → verify → login against a Mailpit sink (reads the message via Mailpit's REST API). CI runs a `mailpit` service with `SMTP_HOST`/`SMTP_PORT` set; the test is gated on `DB_HOST` and skips on a bare local run.

#### Transport options

| Mode | When | Config |
|------|------|--------|
| Console | `SMTP_HOST` empty | none — links logged to server console |
| Local Mailpit | local testing of real send | `SMTP_HOST=localhost`, `SMTP_PORT=1025` (no user/pass) |
| Gmail SMTP | production (free, ~500/day) | `smtp.gmail.com:587` + App Password |

**Local testing with Mailpit** — capture outgoing email in a local inbox without
sending it externally:

```sh
cd server
docker compose up -d mailpit   # or `docker compose up -d` for the whole dev stack
```

Set `SMTP_HOST=localhost` and `SMTP_PORT=1025` in `server/.env` (leave
`SMTP_USER`/`SMTP_PASS` empty), restart the dev server, then trigger a flow
(register, forgot-password, email change) and read the message at
http://localhost:8025.

**Production with Gmail SMTP** (no paid provider required):

1. Enable 2-Step Verification on the Google account.
2. Create an **App Password** (Google Account → Security → App passwords) — this
   is a 16-character token, distinct from the login password.
3. In the deployment's `server/.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-account@gmail.com
   SMTP_PASS=<16-char app password>
   SMTP_FROM=your-account@gmail.com
   ```
4. Restart the server container so it re-reads `server/.env`.

> Gmail rewrites the `From` header to the authenticated account — `SMTP_FROM`
> **must** equal `SMTP_USER`, otherwise messages appear spoofed and get
> filtered. Gmail's free sending limit is ~500 recipients/day.

> **CI-deployed VPS:** SMTP creds (like all production secrets) are stored as GitHub repository
> secrets and injected into the VPS `server/.env` by `scripts/sync-prod-env.sh` on every deploy —
> hand-editing the secret-managed keys is overwritten on the next deploy. See the root README
> ["Production credentials & secrets"](../README.md#production-credentials--secrets) for the full
> inventory, the `DB_PASSWORD` caveat, and the from-scratch provisioning checklist.

#### Localization

All transactional emails are rendered from a shared, branded Handlebars layout
(`mail/email.template.ts`) with locale-specific copy (`mail/mail-content.ts`).
Each message is sent in the recipient's stored `users.locale` (EN/RU; defaults
to `en`). The locale is captured at registration (optional `locale` field) and
editable from the client profile.

### Database

Core tables managed via TypeORM migrations:

| Table | Description |
|-------|-------------|
| `users` | UUID PK, email (unique), name, bcrypt password (nullable for OAuth-only), isActive, isEmailVerified, `locale` (email language, default `en`), failedLoginAttempts, lockedUntil, verification/reset token fields, `deleted_at TIMESTAMPTZ NULL` (soft delete); ManyToMany to roles via user_roles |
| `oauth_accounts` | UUID PK, provider + provider_id (unique), FK to users (CASCADE) |
| `refresh_tokens` | UUID PK, token (SHA-256 hashed), FK to users (CASCADE), expires_at, revoked |
| `roles` | UUID PK, name (unique), description, isSystem flag, isSuper flag |
| `resources` | UUID PK, name (unique), displayName, description, isSystem flag, `is_orphaned` boolean (marked true when controller removed; excluded from CASL subject map until restored), `allowed_action_names text[]` |
| `actions` | UUID PK, name (unique), displayName, description, isSystem flag, sortOrder |
| `permissions` | UUID PK, resource_id + action_id (unique constraint, FKs to resources and actions) |
| `role_permissions` | FK to roles + permissions, optional jsonb `conditions` |
| `user_roles` | Join table: user_id + role_id (composite PK) |
| `audit_logs` | UUID PK, action (enum), actorId (nullable), actorEmail (nullable), targetId (nullable), targetType (nullable), details (jsonb), ipAddress, requestId, createdAt |

Billing tables (subscriptions foundation; money is always stored in minor units). The overflow-prone money/quantity columns (`billing_invoices.amount_minor`/`refunded_minor`, `billing_credit_balances.balance_units`, `billing_credit_ledger.delta`, `billing_usage_records.quantity`) are `bigint`, decoded to a `Money` BigInt value object by `moneyColumnTransformer` (`common/utils/money-column.transformer.ts`) and serialized to the wire `number` via `@MoneyToNumber()`; pure counters stay `integer`. All billing arithmetic goes through `Money` — no floating-point:

| Table | Description |
|-------|-------------|
| `plans` | UUID PK, key (unique), name, `billing_mode` (`fixed`/`usage`), `interval`, `meter_key` (usage), `entitlements text[]` (GIN-indexed), `limits jsonb`, `trial_days`, `active`, `prices jsonb` (per-provider `{ currency, amountMinor, unitPriceMinor?, includedUnits? }`) |
| `billing_customers` | UUID PK, `user_id` (unique FK to users, CASCADE), `provider`, `provider_override` (manual region override), `provider_customer_id`, `country`, `currency`, `default_payment_method_id` (FK to billing_payment_methods, SET NULL) |
| `billing_payment_methods` | UUID PK, `customer_id` (FK, CASCADE), `provider`, `provider_method_ref`, `brand`, `last4`, `is_default` |
| `subscriptions` | UUID PK, `customer_id` (FK, CASCADE), `plan_key`, `provider`, `billing_mode`, `status`, `lifecycle_owner` (`provider`/`self`), current-period bounds, `cancel_at_period_end`, `trial_end`, `provider_subscription_id`, `payment_method_id` (FK, SET NULL) |
| `billing_invoices` | UUID PK, `customer_id` (FK, RESTRICT — financial records must survive customer deletion), `subscription_id` (FK, SET NULL), `provider`, `provider_event_id` (unique, webhook idempotency), `provider_invoice_ref`, `amount_minor`, `refunded_minor` (cumulative refunded units — full vs partial is `refunded_minor` vs `amount_minor`; @Exclude-d from the wire), `currency`, `status`, `billing_mode`, `kind` (`subscription`/`one_time`), `product_id` (FK to billing_products, SET NULL — one-time purchases), period bounds, `paid_at`, `receipt_ref` (54-FZ) |
| `billing_products` | UUID PK, key (unique), name, description, `type` (`sku`/`credits`/`custom`), `prices jsonb` (per-provider `{ currency, amountMinor?, paddlePriceId? }` for fixed-price, `{ currency, minAmountMinor, maxAmountMinor }` for custom), `grant jsonb` (`{ credits }` or `{ entitlement, durationDays? }`, null for custom), `active` |
| `billing_customer_grants` | UUID PK, `customer_id` (FK, CASCADE, indexed), `entitlement`, `source_invoice_id` (FK to billing_invoices, CASCADE — idempotency + refund revocation), `expires_at`, `revoked_at` |
| `billing_credit_balances` | `customer_id` PK (FK, CASCADE), `balance_units` (may go negative after a refund clawback — blocks usage until topped up), `updated_at` |
| `billing_credit_ledger` | UUID PK, `customer_id` (FK, RESTRICT — audit journal must survive customer deletion, indexed), `delta`, `reason` (`purchase`/`usage`/`refund`), `ref_invoice_id` (FK to billing_invoices, SET NULL) — append-only journal of every balance change |
| `billing_usage_records` | UUID PK, `customer_id` (FK, CASCADE), `subscription_id` (FK, CASCADE), `meter_key`, `quantity`, `occurred_at`, `idempotency_key` (unique), `recorded_at` |
| `billing_webhook_events` | UUID PK, `provider`, `provider_event_id`, `type`, `payload_hash`, `payload` (jsonb, nullable — the verified NormalizedEvent, replayed by the reconciliation sweep), `status` (`received`/`processed`/`dead_letter`), `attempts`, `last_error`, `received_at`, `processed_at`; unique `(provider, provider_event_id)` makes a `processed` replay a no-op while a stuck `received` row is reprocessed/swept. A delivery that fails the sweep `WEBHOOK_MAX_REPLAY_ATTEMPTS` times is quarantined as `dead_letter` (stops churning, alerts once) and stays replayable via `POST /admin/billing/webhook-events/:id/replay` or a provider redelivery |

Migration and seed commands operate on compiled JS in `dist/` — always run `npm run build` first.

## Deployment behind a reverse proxy

When the app runs behind nginx, Caddy, a Kubernetes ingress, or Cloudflare, the
TCP peer for every request is the proxy — not the real client. Without any
configuration, `req.ip` is the proxy's IP for every request, which silently
breaks:

- `@nestjs/throttler` — all traffic is keyed under one IP, so either every
  request counts toward the same quota (global lockout) or the quota is
  effectively disabled
- the `login-long-window` throttler that protects against brute-force account
  lockout
- `AuditService` IP recording — audit logs show the proxy's IP, not the real
  client

Set `TRUSTED_PROXIES` so Express trusts the `X-Forwarded-For` header from your
proxy (and, importantly, _only_ from it). Examples:

| Deployment | Recommended value |
|------------|-------------------|
| nginx / Caddy on the same host | `loopback` |
| Sidecar proxy in Kubernetes | `loopback,uniquelocal` |
| Two hops (e.g. CDN → nginx → app) | `2` |
| Cloudflare with no private-range proxy in front | Cloudflare's published CIDR list, comma-separated |

Do **not** set `TRUSTED_PROXIES=true` unless you are certain nothing untrusted
can reach the app directly — it causes Express to trust `X-Forwarded-For` from
any source, which lets clients spoof their IP.

See the Express [trust proxy docs](https://expressjs.com/en/guide/behind-proxies.html)
for the full syntax.

## Rate limiting

Configured in `CoreModule` via `@nestjs/throttler`. Two throttlers run in parallel:

| Throttler | Window | Limit | Notes |
|-----------|--------|-------|-------|
| `default` (unnamed) | 60 s | 120 req/IP | SPA-wide soft ceiling. Per-route `@Throttle({ default: { ttl, limit } })` decorators override this on sensitive endpoints. |
| `login-long-window` | 15 min (`LOCKOUT_DURATION_MS`) | 4 999 (`MAX_FAILED_ATTEMPTS * 1000`) | Effectively disabled globally; tightened to `MAX_FAILED_ATTEMPTS - 1` on `/auth/login` so an IP cannot accumulate enough failed attempts to trip the account-lockout protection (SEC-6). |

When `REDIS_URL` is set the throttler uses `RedisThrottlerStorage` so counters are shared across all instances; otherwise it falls back to the in-process memory store (single-instance only).

The billing webhook receivers (`POST /billing/webhooks/paddle`, `POST /billing/webhooks/yookassa`) carry `@SkipThrottle()`: payment providers deliver from a small set of egress IPs, so all of a provider's webhooks would share one per-IP bucket and a legitimate renewal batch could get 429'd. Authenticity is enforced by signature verification (Paddle) / API re-fetch (YooKassa) and ingestion is idempotent, so the throttle adds no protection on these routes. With the throttle skipped, unauthenticated traffic to these routes is bounded by the source-IP allowlist below.

### Billing webhook source-IP allowlist

`WebhookIpAllowlistGuard` rejects requests to `/billing/webhooks/*` with `403` unless the client IP matches `BILLING_WEBHOOK_IP_ALLOWLIST` (comma-separated IPs/CIDRs, IPv6 supported). The check runs before any webhook processing - in particular before the outbound YooKassa payment re-fetch, which is what an arbitrary internet host could otherwise trigger at will (YooKassa notifications are unsigned by design; for HMAC-verified Paddle the allowlist is defense in depth).

- Empty/unset disables the check - local dev and the e2e suites run open.
- `docker-compose.yml` sets the production default to the provider egress ranges published at [Paddle: respond to webhooks](https://developer.paddle.com/webhooks/about/respond-to-webhooks/) (live + sandbox) and [YooKassa: webhooks](https://yookassa.ru/developers/using-api/webhooks), verified 2026-07-05. Both providers recommend allowlisting.
- **Update procedure:** if a provider's webhooks start being rejected, the guard logs each rejection as a warning with the source IP - re-check the two pages above and update the default in `docker-compose.yml`. Export `BILLING_WEBHOOK_IP_ALLOWLIST` empty to disable the check temporarily without editing the file.
- A malformed entry fails startup deliberately (a deploy that cannot enforce the list should fail loudly, not fall open or drop webhooks silently).
- The guard reads `req.ip`, so behind a reverse proxy `TRUSTED_PROXIES` must be configured (see [Deployment behind a reverse proxy](#deployment-behind-a-reverse-proxy)); a spoofed `X-Forwarded-For` from an untrusted peer is ignored.

Per-route overrides currently in use:

| Endpoint | Window | Limit | Why |
|----------|--------|-------|-----|
| `POST /auth/register` | 1 h | 5 | Account creation flood control. CAPTCHA soft-trigger kicks in near the limit. |
| `POST /auth/login` | 1 min | 3 (default) + `login-long-window` | Brute-force credentials + lockout protection. |
| `POST /auth/refresh-token` | 1 min | 5 | Bound to a real session — abuse would mean stolen cookies. |
| `POST /auth/profile/email/initiate` | 1 h | 3 | Confirmation email cost + enumeration mitigation. |
| `POST /auth/profile/email/confirm` | 1 min | 10 | Token brute-force defense in depth (token entropy already infeasible). |
| `POST /auth/verify-email` | 1 min | 10 | Same. |
| `POST /auth/resend-verification` | 1 min | 3 | Email cost. |
| `POST /auth/forgot-password` | 5 min | 2 | Email cost + enumeration mitigation. CAPTCHA soft-trigger near the limit. |
| `POST /auth/reset-password` | 1 min | 10 | Token brute-force defense in depth. |
| `POST /auth/oauth/exchange` | 1 min | 10 | State-token-bound; tight enough to neutralise replay attempts. |
| `GET /rbac/metadata` | 1 min | 30 | Bumped because every admin route guard reads it. |

When a request is rejected the response is the standard `429` with `{ statusCode, message, error, timestamp, path }`.

## Enabling CAPTCHA in production

CAPTCHA on `/register` and `/forgot-password` is **disabled by default**. After
deploy the endpoints are protected only by the rate-limiter (5 req/hour for
register, 2 req/5min for forgot-password per IP). To enable a Cloudflare
Turnstile soft-trigger challenge that activates when an IP nears the rate
limit:

1. **Get keys from Cloudflare** (free, ~2 minutes):
   - Sign in at https://dash.cloudflare.com (any plan, including Free)
   - Open **Turnstile** → **Add site**
   - Enter your production domain (only this domain will be allowed to use
     the site key — protects against your key being embedded on other sites)
   - Widget Mode: **Managed** (Cloudflare picks interactive vs invisible
     based on risk score; recommended)
   - Save and copy the generated **Site Key** and **Secret Key**

2. **Set the keys** — pick one of:

   **Recommended (rebuild-safe):** add the two values as GitHub repository
   secrets — `TURNSTILE_SITE_KEY` (the public site key) and
   `TURNSTILE_SECRET_KEY` (the sensitive secret key). On the next
   `deploy.yml` / `rebuild.yml` run, `scripts/sync-prod-env.sh` writes both
   into the VPS `server/.env` automatically (they join the same managed
   list as `SMTP_*`, `JWT_*`, `DB_PASSWORD`, etc. — see the root
   `README.md` §"Production credentials & secrets"). A from-scratch VPS
   rebuild restores them along with every other managed secret.

   **Quick local edit (overwritten on next deploy if the GitHub secret
   is set):**
   ```bash
   ssh user@your-vps
   cd /path/to/project
   nano server/.env
   # Add or replace:
   #   TURNSTILE_SITE_KEY=0x4AAAAAAA...   ← your real Site Key
   #   TURNSTILE_SECRET_KEY=0x4AAAAAAA... ← your real Secret Key
   chmod 600 server/.env
   ```

3. **Apply the change:**
   - **GitHub-secrets path:** trigger a deploy (push to master, or run
     `deploy.yml` via `workflow_dispatch`). The sync script writes the
     keys, then `docker compose up -d` picks them up.
   - **Local-edit path:** restart only the `server` service:
     ```bash
     docker compose up -d server
     ```
   In both cases the client does **not** need to be rebuilt — it fetches
   the public Site Key at runtime from `GET /api/v1/auth/captcha-config`.

4. **Verify**:
   ```bash
   curl https://your-domain/api/v1/auth/captcha-config
   # → {"enabled":true,"provider":"turnstile","siteKey":"0x4AAAAAAA..."}
   ```
   Open `/register` in a browser, submit the form 4 times in a row (use
   different emails or expect 409 on existing). On the 4th attempt the
   widget should appear; once solved, registration goes through.

5. **Disable temporarily** (e.g. if Cloudflare has an outage and the
   `Turnstile siteverify request failed` log starts spamming): clear
   both `TURNSTILE_*` GitHub secrets (empty value) and trigger a deploy
   — `sync-prod-env.sh` skips empty values, so this alone does **not**
   clear `server/.env`; for an immediate fix, also comment the keys on
   the VPS:
   ```bash
   sed -i 's/^TURNSTILE_/# TURNSTILE_/' server/.env
   docker compose up -d server
   ```
   Re-enable by restoring the secrets (and uncommenting the lines if you
   used the manual path).

### Content-Security-Policy requirements

The Turnstile script and the challenge widget load from
`https://challenges.cloudflare.com`. The client's CSP **must** allow it in
both `script-src` (for `api.js?render=explicit`) and `frame-src` (for the
embedded challenge iframe); otherwise the backend will keep returning
`CAPTCHA_REQUIRED` while the browser silently blocks the widget, and users
see only the "Please complete the CAPTCHA challenge to continue" error with
no widget to solve.

The shipped `client/nginx.conf` already includes both directives in every
`add_header Content-Security-Policy` rule. If you front the client with a
different reverse proxy / CDN (Caddy, Cloudflare, CloudFront, …) or
customise the nginx config, ensure the served CSP contains:

```
script-src 'self' https://challenges.cloudflare.com
frame-src https://challenges.cloudflare.com
```

Quick check from any environment:
```bash
curl -sI https://your-domain/ | grep -i content-security-policy
```

### Test keys vs production keys

| Key pair | Behaviour | Use case |
|----------|-----------|----------|
| `1x00000000000000000000AA` / `1x0000000000000000000000000000000AA` | Always pass — public, anyone can mint a token | Local dev, unit tests, CI — **never production** |
| `2x00000000000000000000AB` / `2x0000000000000000000000000000000AA` | Always block — useful for testing the failure path | Negative-path tests |
| Real Site Key + Secret Key from your dashboard | Real ML-driven challenge | Production |

The test keys are **public** — bots can use them too. They provide zero
abuse protection. A production deploy that leaves `TURNSTILE_*` set to test
values is effectively the same as having CAPTCHA disabled (and worse,
because users see a widget that does nothing useful).

### What if you don't want a Cloudflare dependency?

The throttler alone (5/h register, 2/5min forgot-password) gives reasonable
protection against single-IP brute force. If you observe spam in
`audit_logs` despite the throttler, options are:

- Switch the provider to hCaptcha — change the `siteverify` URL in
  `CaptchaService` and the script URL in `CaptchaService.loadScript()`;
  the protocol is identical (form-encoded `secret`/`response`,
  JSON `{ success: boolean }` reply). hCaptcha also requires an account.
- Self-host a CAPTCHA-free proof-of-work challenge (mCaptcha, Friendly
  Captcha) — adds a container to `docker-compose.yml`, no external account.
- Add a honeypot field + minimum form-fill time as a first line — works
  out of the box, no third-party dependency, but bypassed by smarter bots.

## Observability

### Prometheus metrics

The `MetricsModule` (`src/modules/core/metrics/metrics.module.ts`) exposes
`GET /metrics` (excluded from the `/api` prefix, reachable without auth via
`@Public()`). Counters and histograms:

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | counter | `method`, `route`, `status_code` | Every HTTP request reaching the app |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status_code` | Per-route request latency (seconds) |
| `auth_events_total` | counter | `event` ∈ `login_success`, `login_failure`, `token_refresh_success`, `token_refresh_failure`, `token_reuse_detected`, `logout`, `register` | Authentication events |
| `rbac_permission_denied_total` | counter | `action`, `subject`, `level` ∈ `guard`, `instance` | RBAC/ABAC denials. `level=guard` is an `@Authorize` decorator rejection; `level=instance` is an `ability.can(action, entity)` rejection after the record was loaded |
| `sse_connections_active` | gauge | — | Currently open SSE notification streams |
| `mail_queue_jobs` | gauge | `state` ∈ `waiting`, `active`, `completed`, `failed`, `delayed` | BullMQ mail-queue depth by job state. No-ops (stays absent) when no queue is configured — i.e. `REDIS_URL` unset, so `MailService` sends in-process |
| `mail_jobs_processed_total` | counter | `outcome` ∈ `completed`, `failed` | Mail jobs processed by the queue worker. `failed` counts each failed attempt, including retries |
| `db_pool_connections` | gauge | `state` ∈ `total`, `idle`, `waiting` | PostgreSQL connection-pool size by state, read from the pg pool on the injected `DataSource`. A sustained `waiting` > 0 means the pool is exhausted and requests are queuing |
| `cache_requests_total` | counter | `cache` ∈ `permissions`, `roles`, `resources`, `feature_flags`, `feature_flags_all`, `outcome` ∈ `hit`, `miss` | Redis-backed cache lookups by logical cache and outcome. Hit ratio = `hit / (hit + miss)` per `cache`; a persistently low ratio means the cache is invalidated faster than it serves hits |

Plus the default Node.js process metrics (heap, GC, event-loop lag, file
descriptors, ...) provided by `prom-client`.

### Scrape configuration

The bundled `monitoring/prometheus.yml` already targets `server:3000 → /metrics`
on a 15-second interval inside the Docker Compose network. Self-hosted
Prometheus instances should add an equivalent scrape job.

### Permission-denied alert recipes

`rbac_permission_denied_total` is the single best signal for unexpected RBAC
behaviour — misconfigured roles, brute-force probing of admin routes, a
front-end bug that hits endpoints the user is not entitled to, or a
regression that introduces a new check before the seed data was updated.

Drop the following into a Prometheus rules file (e.g. `monitoring/rbac-rules.yml`,
loaded via `rule_files:` in `prometheus.yml`). Thresholds are starting points
— tune them to your baseline traffic before paging on them:

```yaml
groups:
  - name: rbac
    rules:
      # 1. Burst: > 10 denials/min averaged over a 5-min window.
      # Usually points at a deploy that broke a role, or a runaway script.
      - alert: RbacDenialBurst
        expr: sum(rate(rbac_permission_denied_total[5m])) * 60 > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "RBAC denials averaging > 10/min over 5 min"
          description: |
            Per-subject breakdown:
              sum by (subject, action) (rate(rbac_permission_denied_total[5m]))

      # 2. Concentrated abuse: one subject takes > 70 % of denials.
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
          summary: "Single subject accounts for > 70 % of RBAC denials"

      # 3. Instance-level denial spike — usually an ownership-check bug or
      # a tampered client cache. Guards block typed access; instance checks
      # block "you don't own this row", so a sudden rise often means the UI
      # is showing rows that shouldn't be visible.
      - alert: RbacInstanceDenialSpike
        expr: sum(rate(rbac_permission_denied_total{level="instance"}[5m])) * 60 > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Instance-level RBAC denials > 5/min over 5 min"

      # 4. Sustained background noise — under steady load these counters
      # should sit near zero for an authenticated user. Long-running
      # drizzle is usually a broken UI that hides nothing client-side.
      - alert: RbacDenialChronic
        expr: sum(rate(rbac_permission_denied_total[30m])) * 60 > 2
        for: 30m
        labels:
          severity: info
        annotations:
          summary: "RBAC denials > 2/min for 30 min (likely a UI bug, not abuse)"
```

For low-traffic deployments, replace `rate(...)` with
`increase(rbac_permission_denied_total[1h]) > N` so the alert is not eaten
by ratio-against-tiny-base noise.

### Grafana dashboard

A starter dashboard focused on permission-denied breakdown lives at
`doc/grafana/rbac.json` (the project's `doc/` folder is intentionally
gitignored — copy or symlink it where you need it). Import via
**Grafana → Dashboards → New → Import** and select the Prometheus
datasource bundled with the Docker stack (UID `prometheus`).

Panels:

- Denials/min (overall, 5-min window) — single stat
- Denials/sec by level (`guard` vs `instance`) — time series
- Top (subject, action) denials over 5 min — bar gauge
- Distribution of denials by subject over 1 h — pie chart
- Cumulative denials by (subject, action) over 24 h — table

The provisioned **App Metrics** dashboard
(`monitoring/grafana/provisioning/dashboards/nexus.json`) covers the
remaining metrics (HTTP traffic, auth events, latency p95s, SSE, Node.js
runtime) plus an RBAC & Reliability section (permission denials by level
and action/subject, process RSS memory, token-reuse-detected alarm,
uptime, active handles/requests), a Mail Queue section (BullMQ depth by
state, failed/completed job counts over 1 h), and a Database section (connection-pool
size by state with a waiting-connections alarm). Use the dedicated RBAC dashboard
(`doc/grafana/rbac.json`) alongside it for deeper security drill-downs.

## Docker

A multi-stage `Dockerfile` is provided for production builds.

**Build stages:**
1. **deps** — installs production `node_modules` only (with `npm ci --omit=dev`)
2. **builder** — installs all deps + compiles TypeScript (`nest build`) including `shared/`
3. **runner** — copies `dist/` and production `node_modules`, runs `docker-entrypoint.sh`

**`docker-entrypoint.sh`** (executed on container start):
```sh
typeorm migration:run      # Apply pending migrations
node dist/server/src/seed-admin.js   # Create admin user if ADMIN_EMAIL set
exec node dist/server/src/main       # Start NestJS
```

The admin seeder (`src/seed-admin.ts`) reads `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_FIRST_NAME`, `ADMIN_LAST_NAME` from the environment. It is idempotent — skips if the user already exists or if `ADMIN_EMAIL` is not set.

The repo-root `docker-compose.yml` is the **production** stack (db + redis + server + client + monitoring) deployed to the VPS — not for local use. For local development, run the API on the host (`npm run start:dev`) against the dev backing services in `server/docker-compose.yml`.

---

## API

Swagger docs: http://localhost:3000/swagger (enabled in `local` and `development` by default; set `SWAGGER_ENABLED=true` to enable in any environment)

Base URL: `/api/v1`

### Auth (`/api/v1/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | None | Register user (sends verification email) |
| POST | `/login` | None | Login, returns JWT + refresh token |
| POST | `/refresh-token` | None | Refresh access token |
| POST | `/logout` | Bearer | Revoke all refresh tokens |
| GET | `/profile` | Bearer | Get current user |
| PATCH | `/profile` | Bearer | Update own profile (name, password); `currentPassword` required when changing password (OAuth-only users may omit) |
| POST | `/profile/email/initiate` | Bearer | Step 1 of self-service email change (3/hour). Requires `currentPassword`; rejects OAuth-only accounts; stores `pendingEmail`/`pendingEmailToken` (1h expiry); sends confirmation link to new address and a no-link masked alert to old address. Response is enumeration-safe |
| POST | `/profile/email/confirm` | None | Step 2 — confirms the new email via the token, applies the change atomically, revokes all refresh tokens, notifies the old address |
| GET | `/permissions` | Bearer | Get current user's resolved permissions |
| POST | `/verify-email` | None | Verify email address using token |
| POST | `/resend-verification` | None | Resend email verification (3/min) |
| POST | `/forgot-password` | None | Request password reset email (2 per 5 min); CAPTCHA token required when near rate limit |
| POST | `/reset-password` | None | Reset password using token |
| GET | `/captcha-config` | None | Public CAPTCHA configuration (provider, site key, enabled flag) |

### OAuth (`/api/v1/auth/oauth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/:provider` | None | Initiate OAuth login (google, facebook, vk) |
| GET | `/:provider/callback` | None | OAuth provider callback → redirect to client |
| GET | `/accounts` | Bearer | List linked OAuth accounts |
| DELETE | `/accounts/:provider` | Bearer | Unlink OAuth provider |

### Roles (`/api/v1/roles`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | `roles:create` | Create role |
| GET | `/` | `roles:read` | List all roles with permissions |
| GET | `/:id` | `roles:read` | Get role by ID |
| PATCH | `/:id` | `roles:update` | Update role |
| DELETE | `/:id` | `roles:delete` | Delete role |
| GET | `/permissions` | `roles:read` | List all available permissions |
| GET | `/:id/permissions` | `roles:read` | Get permissions assigned to a specific role |
| PUT | `/:id/permissions` | `roles:update` | Bulk-replace the full permission set for a role |
| POST | `/:id/permissions` | `roles:update` | Assign permissions to role |
| DELETE | `/:id/permissions/:permissionId` | `roles:update` | Remove permission from role |
| POST | `/assign/:userId` | `roles:assign` | Assign role to user |
| DELETE | `/assign/:userId/:roleId` | `roles:assign` | Remove role from user |

### RBAC (`/api/v1/rbac`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/metadata` | `permissions:read` | Get RBAC metadata (resources + actions); Redis-cached 60s |
| GET | `/resources` | `permissions:read` | List all resources |
| PATCH | `/resources/:id` | `permissions:update` | Update resource display info |
| POST | `/resources/:id/restore` | `permissions:update` | Restore orphaned resource; 400 if `@RegisterResource` controller absent |
| GET | `/actions` | `permissions:read` | List all actions |
| POST | `/actions` | `permissions:create` | Create new action |
| PATCH | `/actions/:id` | `permissions:update` | Update action |
| DELETE | `/actions/:id` | `permissions:delete` | Delete custom action |

### Notifications (`/api/v1/notifications`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/stream` | Bearer | SSE stream — pushes `session_invalidated`, `permissions_updated`, `user_crud_events`, and `feature_flags_updated` events |

### Feature Flags (`/api/v1`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/feature-flags` | Optional | Evaluated flags for the caller. Authenticated → each flag resolving `true` plus any `public` flag (disabled non-public flags omitted); anonymous → flags with `public: true`. Returns `{ flags: Record<string, boolean>, evaluatedAt: string }`. Sets `nxs_anon_id` cookie on first request |
| GET | `/admin/feature-flags` | `manage:FeatureFlag` | List all flags with their rules |
| GET | `/admin/feature-flags/:id` | `manage:FeatureFlag` | Get a flag by ID |
| POST | `/admin/feature-flags` | `manage:FeatureFlag` | Create a flag (audited as `FEATURE_FLAG_CREATE`) |
| PATCH | `/admin/feature-flags/:id` | `manage:FeatureFlag` | Update a flag. **Requires `If-Match: <version>` header**; HTTP 409 (`errorKey: errors.featureFlags.versionConflict`) on mismatch; HTTP 428 (`errors.featureFlags.ifMatchRequired`) when missing |
| DELETE | `/admin/feature-flags/:id` | `manage:FeatureFlag` | Cascade-delete a flag (audited as `FEATURE_FLAG_DELETE`) |
| PUT | `/admin/feature-flags/:id/rules` | `manage:FeatureFlag` | Replace the full rule set in one transaction (audited as `FEATURE_FLAG_RULES_REPLACE`) |
| POST | `/admin/feature-flags/:id/toggle` | `manage:FeatureFlag` | Flip `enabled` and increment version (audited as `FEATURE_FLAG_TOGGLE`) |

**Caching:**
- `featureflags:all` — full flag/rule set, TTL 300 s. Reloads are single-flight: concurrent cache misses share one DB load, and a load overlapped by an invalidation skips its cache write (generation guard) so pre-change rows are never re-cached
- `featureflags:version` — monotonic counter, bumped on any change; appended to per-user keys so old entries orphan naturally
- `featureflags:user:<userId>:v<version>` — evaluated map, TTL 60 s. Anonymous callers are not cached

**Real-time updates:** `FeatureFlagChangedListener` broadcasts `{ type: 'feature_flags_updated' }` over SSE on flag change. The cache is invalidated per change, but the broadcast is coalesced (500 ms window) so a burst of changes — e.g. one dialog save emitting update + rules-replaced — triggers a single synchronized client refetch instead of one per change. `UserRoleChangedEvent` and `UserDeletedEvent` invalidate just the affected user's cache. Cross-module communication via `EventEmitter2`, not `forwardRef`.

**Anonymous bucketing:** `AnonIdMiddleware` issues the `nxs_anon_id` cookie on first request to any route (`SameSite=Lax`, `Secure` in production, 1-year `maxAge`, `httpOnly: false`). The cookie value seeds the percentage-bucket hash so a 10 % rollout of a public flag converges on the same 10 % of anonymous browsers across reloads.

> **Anonymous percentage rollouts are deterministic but client-controllable, not a security boundary.** Because the bucket key for an anonymous caller is the `nxs_anon_id` cookie (`httpOnly: false`, so readable/writable from JavaScript), a client can rotate the cookie until it lands in a targeted percentage bucket. This is acceptable by design — anonymous callers only ever see `public: true` flags, and any sensitive feature must require authentication (where bucketing keys on the immutable `userId`, which is not client-controllable). Never rely on an anonymous percentage rollout for access control or data isolation; treat it purely as a gradual-exposure mechanism. If a future flag needs anonymous rollouts to resist grinding, HMAC-sign the `nxs_anon_id` value with a server secret so a client cannot forge buckets.

**`@RequireFeature('key')` decorator** (convenience):
```ts
@Get('/beta')
@RequireFeature('new-dashboard')
@Authorize(['read', 'Dashboard'])  // RBAC remains the real gate
getBetaDashboard() { ... }
```
`FeatureFlagGuard` returns HTTP 404 (anti-enumeration) when the flag is disabled for the caller. **Never use as the sole authorization gate.**

**Extending the attribute registry** for non-user-bound targeting (tenant, organization, region, subscription tier, ...):
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
Admin UIs can then write rules referencing `{ field: 'custom', customKey: 'tenantId', op: 'in', value: ['acme', 'globex'] }`. The write-time validator rejects any `customKey` not registered.

> **Request-stable contract.** A resolver MUST return a stable value for a given user across requests — it may use the `user` argument but MUST NOT branch on per-request data (IP, headers, query string, country, …). `evaluateForUser` caches the full evaluated set per user for 60s (`featureflags:user:<id>:v<version>`), so a request-derived attribute would freeze the first request's value for the whole TTL and make attribute rules non-deterministic per request. The resolver receives `req` only for stable, request-independent enrichment.

**Audit trail.** Every mutating admin endpoint writes to `audit_logs` under one of the `FEATURE_FLAG_*` enum values (`FEATURE_FLAG_CREATE`, `_UPDATE`, `_DELETE`, `_TOGGLE`, `_RULES_REPLACE`). The `details` JSONB captures `key`, `changedFields`, `ruleCount`, or `enabled`, depending on the action — never the raw rule payload, so admin-only segmentation strategy never leaks into the audit log.

**Adding a new flag from a feature module.** No code is needed at the flag site beyond `@RequireFeature('key')` on the handler. Configuration is purely runtime: create the flag through the admin UI / API, attach rules if you want partial roll-out, and verify with `GET /api/v1/feature-flags` as the target caller. The flag's `key` is a free-form string (lowercase letters, digits, hyphens) — pick one with the same name as the gate so a future reader can grep from code to config.

### Users (`/api/v1/users`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | `users:create` | Create user |
| GET | `/` | `users:search` | List all users (paginated; `includeDeleted=true` to include soft-deleted) |
| GET | `/search` | `users:search` | Search users (paginated + filters: `q` (unified substring across id/email/firstName/lastName), email, firstName, lastName, `role` (exact role name), isActive; `includeDeleted=true`) |
| GET | `/cursor` | `users:search` | List users with cursor-based (keyset) pagination |
| GET | `/search/cursor` | `users:search` | Search users with cursor-based pagination + same filters as `/search` |
| GET | `/:id` | `users:read` | Get user by ID |
| GET | `/:id/permissions` | `users:read` | Get effective permissions for user (roles + resolved permissions + packed CASL rules) |
| PATCH | `/:id` | `users:update` | Update user (email, name, password, `isActive` deactivate/reactivate, `unlockAccount`) |
| DELETE | `/:id` | `users:delete` | Soft-delete user (sets `deleted_at`, revokes all active sessions) |
| POST | `/:id/restore` | `users:delete` | Restore soft-deleted user (clears `deleted_at`, sets `isActive=true`) |

**Pagination query params:**
- `page` (default 1)
- `limit` (default 10, max 100)
- `sortBy` (default createdAt)
- `sortOrder` (default desc for list, asc for search)

**Response format for offset-paginated endpoints:**
```json
{
  "data": [UserResponseDto, ...],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 70,
    "totalPages": 7
  }
}
```

**Cursor-based pagination query params** (`/cursor`, `/search/cursor`):
- `cursor` (opaque token from previous response; omit for first page)
- `limit` (default 20, max 100)
- `sortBy` (default createdAt)
- `sortOrder` (default desc)

**Response format for cursor-paginated endpoints:**
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

## Testing

### Unit Tests (Jest)

- Test files: `*.spec.ts` alongside source files
- Environment: Node

```bash
npm test                   # Run all
npm run test:watch         # Watch mode
npm run test:cov           # Coverage report
npx jest --testPathPattern=auth   # Run specific tests
```

### E2E Tests (Jest)

- Separate config: `test/jest-e2e.json`

```bash
npm run test:e2e
```

## Shared Module

Server imports common types and constants from the root `shared/` directory via `@app/shared/*` path alias (maps to `../shared/src/*` in `tsconfig.json`). This includes:

- **Types**: `UserResponse` (public), `AdminUserResponse` (admin-only superset with `lockedUntil` + `roles: RoleAdminResponse[]`), `OAuthAccountResponse`, `TokensResponse`, `AuthResponse`, `PaginationMeta`, `PaginatedResponse<T>`, `CursorPaginationMeta`, `CursorPaginatedResponse<T>`, `SortOrder`; `RoleResponse` (public, no `isSystem`/`isSuper`), `RoleAdminResponse` (admin-only superset), `PermissionResponse`, `RolePermissionResponse`, `RoleWithPermissionsResponse`, `PermissionCondition`, `PermissionEffect`, `ResolvedPermission`, `UserPermissionsResponse`, `UserEffectivePermissionsResponse`; `ResourceResponse`, `ActionResponse`, `RbacMetadataResponse`
- **Constants**: `PASSWORD_REGEX`, `PASSWORD_ERROR`, `MAX_FAILED_ATTEMPTS`, `LOCKOUT_DURATION_MS`, `MAX_CONCURRENT_SESSIONS`, pagination defaults, user sort columns; `SYSTEM_ROLES`, `SystemRole` (note: `PERMISSIONS` + `Permission` removed — typed `[Actions, Subjects]` tuples used instead)
- **Utils**: `@app/shared/utils/time` (single import site re-exporting `Temporal` from the `temporal-polyfill` package, pinned exactly until native Temporal ships) and `@app/shared/utils/money` (`Money`, a BigInt value object over integer minor units with an overflow-guarded `toNumber()` for the JSON wire — no floating-point math)

NestJS build compiles shared files into `dist/shared/` alongside `dist/server/`. Migration and seed scripts use paths like `dist/server/src/...` to reflect the nested output structure.

## Versioning

This package's version is kept in sync with `client/` and `mock-server/` via `commit-and-tag-version`. To cut a release, run `npm run release` from `client/` — it bumps `server/package.json` automatically.

## Tech Stack

| Technology | Version |
|------------|---------|
| NestJS | 11.1.17 |
| TypeORM | 0.3.28 |
| PostgreSQL | via `pg` 8.20.0 |
| Passport | 0.7.0 |
| bcrypt | 6.0.0 |
| class-validator | 0.14.4 |
| @nestjs/swagger | 11.2.6 |
| @nestjs/schedule | 6.1.1 |
| cache-manager-redis-yet | 5.1.5 |
| ioredis | 5.10.1 |
| TypeScript | 5.9.3 |
| Jest | 30.2.0 |
| ESLint | 9.39.4 |
| Prettier | 3.8.1 |
