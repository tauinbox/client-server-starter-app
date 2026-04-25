# Server

NestJS 11 REST API with JWT authentication, PostgreSQL via TypeORM, and Swagger documentation.

## Getting Started

```bash
npm install
cp .env.example .env      # Configure database and JWT settings
npm run build
npm run migrations:run     # Apply database schema
npm run seed:run           # Optional: seed sample data
npm run start:dev          # Dev server at http://localhost:3000
```

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
| `SMTP_USER` | - | SMTP username |
| `SMTP_PASS` | - | SMTP password |
| `SMTP_FROM` | `noreply@example.com` | Sender email address |
| `REDIS_URL` | - | Redis connection URL (optional; enables distributed rate limiting and shared permission cache for multi-instance deployments) |
| `AUDIT_LOG_RETENTION_DAYS` | `90` | Days to retain audit log entries before nightly deletion |
| `DB_POOL_MAX` | `10` | Maximum PostgreSQL connection pool size |
| `DB_POOL_IDLE_TIMEOUT` | `30000` | Milliseconds before an idle connection is closed |
| `DB_POOL_CONNECTION_TIMEOUT` | `5000` | Milliseconds to wait for a connection before erroring |
| `CORS_ORIGINS` | - | Comma-separated allowed origins (e.g. `https://app.example.com,https://admin.example.com`); `*` is rejected in production |
| `TRUSTED_PROXIES` | - (local), `loopback,uniquelocal` (docker-compose) | Express `trust proxy` setting. Required behind a reverse proxy so `req.ip` resolves to the real client (see [Deployment behind a reverse proxy](#deployment-behind-a-reverse-proxy)). Accepts `loopback` / `linklocal` / `uniquelocal`, a comma-separated IP/CIDR list, a hop count (e.g. `1`), or `true`. The application has no built-in default — leave the env var empty to disable. The repo's `docker-compose.yml` overrides this to `loopback,uniquelocal` for prod deployments behind a host-local reverse proxy or a docker-bridge sidecar; export `TRUSTED_PROXIES` in the shell to override. |

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
│   ├── health/             # HealthModule (GET /api/health/live, /api/health/ready — DB ping + Redis warning in production + optional SMTP)
│   ├── metrics/            # MetricsModule (@Global) — Prometheus metrics via @willsoto/nestjs-prometheus
│   │                       #   GET /metrics (excluded from /api prefix); http_requests_total,
│   │                       #   http_request_duration_seconds, auth_events_total,
│   │                       #   rbac_permission_denied_total{action,subject,level}; HttpMetricsInterceptor
│   └── schedule/           # @nestjs/schedule for cron jobs
├── auth/
│   ├── controllers/        # AuthController (includes GET /permissions), OAuthController, RbacController
│   ├── services/           # AuthService, OAuthService, TokenGeneratorService, RefreshTokenService, OAuthAccountService, TokenCleanupService, ResourceService, ActionService, ResourceSyncService
│   ├── strategies/         # LocalStrategy, JwtStrategy (extracts roles), GoogleStrategy, FacebookStrategy, VkStrategy
│   ├── guards/             # LocalAuthGuard, JwtAuthGuard, Google/Facebook/VkOAuthGuard
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
│   ├── notifications.listener.ts   # @OnEvent() handlers: UserDeleted/PasswordChanged/Created/Updated/Restored/RoleChanged → push
│   └── notifications.controller.ts # GET /stream — @Sse() returns Observable<MessageEvent> merged with 30s heartbeat
└── users/
    ├── controllers/        # UsersController (CRUD + search, all endpoints use @Authorize([action, 'User']))
    ├── services/           # UsersService
    ├── entities/           # User entity (ManyToMany to Role via user_roles)
    └── dto/                # CreateUserDto, UpdateUserDto, UserResponseDto (roles: RoleResponse[])
```

### Request Pipeline

```
Request → Global Middleware (Compression, CookieParser, CORS)
        → Module Middleware
        → Guards (JwtAuthGuard, RolesGuard)
        → Interceptors (ClassSerializer, custom)
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
- **PermissionsGuard** — resolves user permissions (cached 5 min), checks required permissions from typed `@RequirePermissions([Actions, Subjects])`; roles with `isSuper` flag bypass all checks
- **@Authorize([action, subject]) decorator** — composite: `JwtAuthGuard` + `PermissionsGuard` + typed `@RequirePermissions()`. Replaces `@UseGuards(JwtAuthGuard, RolesGuard) @Roles()` pattern
- **CaslAbilityFactory** — builds `AppAbility` from user roles + permissions; used by `AuthController` to return CASL packed rules via `packRules()` from `GET /permissions`. Partitions rules allow-first / deny-last so permissions with `conditions.effect === 'deny'` register as CASL `cannot()` rules and reliably override prior allows for the same `(resource, action)` pair
- **Instance-level enforcement** — `UsersService.update/remove/restore` and `RoleService.assignRoleToUser/removeRoleFromUser` accept an optional `AppAbility` (injected via `@CurrentAbility()` in controllers) and check `ability.can(action, entity)` after loading the record; super-role assignment/removal is blocked for non-super actors
- **JWT payload** — `CustomJwtPayload` carries `email` and optional `roles: string[]` on top of the standard `JwtPayload` claims; access decisions go through CASL/RBAC, not the payload
- **Refresh tokens** — opaque 80-char hex tokens stored in DB (SHA-256 hashed), delivered to the client as an `HttpOnly SameSite=Strict` cookie (`path=/api/v1/auth`), rotated on every use; never appear in response body
- **OAuth accounts** — auto-link by email, manage linked providers, safety check on unlink
- **Token cleanup** — daily cron removes expired tokens, weekly cron removes revoked+expired
- **Account lockout** — 5 failed login attempts → 15 min lock (HTTP 423), admin unlock via user update
- **Email verification** — required before login, 24-hour token expiry, resend capability, OAuth users auto-verified
- **Password reset** — forgot-password/reset-password flow, 30-minute token expiry, invalidates all sessions

### Email (MailModule)

- Uses `nodemailer` for sending verification and password reset emails
- **SMTP transport** when `SMTP_HOST` env var is set (production)
- **Console transport** when `SMTP_HOST` is not set (development) — logs clickable URLs
- Email links use `CLIENT_URL` env var: `${clientUrl}/verify-email?token=xxx`, `${clientUrl}/reset-password?token=xxx`

### Database

Ten tables managed via TypeORM migrations:

| Table | Description |
|-------|-------------|
| `users` | UUID PK, email (unique), name, bcrypt password (nullable for OAuth-only), isActive, isEmailVerified, failedLoginAttempts, lockedUntil, verification/reset token fields, `deleted_at TIMESTAMPTZ NULL` (soft delete); ManyToMany to roles via user_roles |
| `oauth_accounts` | UUID PK, provider + provider_id (unique), FK to users (CASCADE) |
| `refresh_tokens` | UUID PK, token (SHA-256 hashed), FK to users (CASCADE), expires_at, revoked |
| `roles` | UUID PK, name (unique), description, isSystem flag, isSuper flag |
| `resources` | UUID PK, name (unique), displayName, description, isSystem flag, `is_orphaned` boolean (marked true when controller removed; excluded from CASL subject map until restored), `allowed_action_names text[]` |
| `actions` | UUID PK, name (unique), displayName, description, isSystem flag, sortOrder |
| `permissions` | UUID PK, resource_id + action_id (unique constraint, FKs to resources and actions) |
| `role_permissions` | FK to roles + permissions, optional jsonb `conditions` |
| `user_roles` | Join table: user_id + role_id (composite PK) |
| `audit_logs` | UUID PK, action (enum), actorId (nullable), actorEmail (nullable), targetId (nullable), targetType (nullable), details (jsonb), ipAddress, requestId, createdAt |

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

Use `docker-compose.yml` at the repo root to run the full stack (db + server + client).

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
| PATCH | `/profile` | Bearer | Update own profile (name, password) |
| GET | `/permissions` | Bearer | Get current user's resolved permissions |
| POST | `/verify-email` | None | Verify email address using token |
| POST | `/resend-verification` | None | Resend email verification (3/min) |
| POST | `/forgot-password` | None | Request password reset email (3/min) |
| POST | `/reset-password` | None | Reset password using token |

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
| GET | `/metadata` | Bearer | Get RBAC metadata (resources + actions); Redis-cached 60s |
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
| GET | `/stream` | Bearer | SSE stream — pushes `session_invalidated`, `permissions_updated`, and `user_crud_events` events |

### Users (`/api/v1/users`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | `users:create` | Create user |
| GET | `/` | `users:search` | List all users (paginated; `includeDeleted=true` to include soft-deleted) |
| GET | `/search` | `users:search` | Search users (paginated + filters: email, firstName, lastName, isActive; `includeDeleted=true`) |
| GET | `/cursor` | `users:search` | List users with cursor-based (keyset) pagination |
| GET | `/search/cursor` | `users:search` | Search users with cursor-based pagination + filters |
| GET | `/:id` | `users:read` | Get user by ID |
| GET | `/:id/permissions` | `users:read` | Get effective permissions for user (roles + resolved permissions + packed CASL rules) |
| PATCH | `/:id` | `users:update` | Update user |
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

- **Types**: `UserResponse`, `OAuthAccountResponse`, `TokensResponse`, `AuthResponse`, `PaginationMeta`, `PaginatedResponse<T>`, `CursorPaginationMeta`, `CursorPaginatedResponse<T>`, `SortOrder`; `RoleResponse`, `PermissionResponse`, `RolePermissionResponse`, `RoleWithPermissionsResponse`, `PermissionCondition`, `PermissionEffect`, `ResolvedPermission`, `UserPermissionsResponse`, `UserEffectivePermissionsResponse`; `ResourceResponse`, `ActionResponse`, `RbacMetadataResponse`
- **Constants**: `PASSWORD_REGEX`, `PASSWORD_ERROR`, `MAX_FAILED_ATTEMPTS`, `LOCKOUT_DURATION_MS`, `MAX_CONCURRENT_SESSIONS`, pagination defaults, user sort columns; `SYSTEM_ROLES`, `SystemRole` (note: `PERMISSIONS` + `Permission` removed — typed `[Actions, Subjects]` tuples used instead)

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
