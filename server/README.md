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
| Generate migration | `npm run migrations:gen` (build first) |
| Revert migration | `npm run migrations:revert` (build first) |
| Run seeders | `npm run seed:run` (build first) |

## Environment Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Default | Description |
|----------|---------|-------------|
| `APPLICATION_PORT` | `3000` | HTTP listen port |
| `ENVIRONMENT` | `local` | Environment name (`local` enables auto-sync & permissive CORS) |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `my-db` | Database name |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | `password` | Database password |
| `DB_SCHEMA` | `public` | Database schema |
| `DB_LOGGING` | `["query","warn","error","log"]` | TypeORM logging levels |
| `REQUEST_LOG_LEVEL` | `all` | Request logging verbosity: `all` (every request), `warn` (4xx+5xx only), `error` (5xx only) |
| `JWT_SECRET` | `my_jwt_secret_key` | Secret for signing JWTs |
| `JWT_EXPIRATION` | `3600` | Access token lifetime in seconds (1h) |
| `JWT_REFRESH_EXPIRATION` | `604800` | Refresh token lifetime in seconds (7d) |
| `GOOGLE_CLIENT_ID` | - | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | - | Google OAuth client secret |
| `FACEBOOK_CLIENT_ID` | - | Facebook OAuth client ID |
| `FACEBOOK_CLIENT_SECRET` | - | Facebook OAuth client secret |
| `VK_CLIENT_ID` | - | VK OAuth client ID |
| `VK_CLIENT_SECRET` | - | VK OAuth client secret |
| `CLIENT_URL` | `http://localhost:4200` | Client URL for OAuth callback redirects |
| `EXTERNAL_API` | - | Third-party API URL for feature config |
| `EXTERNAL_API_TOKEN` | - | API token for external service |
| `ADMIN_EMAIL` | - | Email for the initial admin user (created on startup if not exists; skip if empty) |
| `ADMIN_PASSWORD` | - | Password for the initial admin user |
| `ADMIN_FIRST_NAME` | `Admin` | First name for the initial admin user |
| `ADMIN_LAST_NAME` | `User` | Last name for the initial admin user |
| `SMTP_HOST` | - | SMTP server host (if unset, emails logged to console) |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | - | SMTP username |
| `SMTP_PASS` | - | SMTP password |
| `SMTP_FROM` | `noreply@example.com` | Sender email address |
| `CORS_ORIGINS` | - | Allowed origins separated by `#` |

## Architecture

### Module Structure

```
src/
├── common/
│   ├── dtos/               # PaginationQueryDto, PaginatedResponseDto<T> (barrel export)
│   └── utils/              # Shared utilities (escapeLikePattern, hashToken, withTransaction)
└── modules/
├── core/                   # Dynamic root module
│   ├── config/             # @nestjs/config, loads .env
│   ├── cache/              # @nestjs/cache-manager
│   ├── database/           # TypeORM + PostgreSQL config
│   ├── filters/            # GlobalExceptionFilter (standardized error responses, DB error mapping)
│   ├── health/             # HealthModule (GET /api/health, TypeORM DB ping)
│   └── schedule/           # @nestjs/schedule for cron jobs
├── auth/
│   ├── controllers/        # AuthController (includes GET /permissions), OAuthController
│   ├── services/           # AuthService, RefreshTokenService, OAuthAccountService, TokenCleanupService
│   ├── strategies/         # LocalStrategy, JwtStrategy (extracts roles), GoogleStrategy, FacebookStrategy, VkStrategy
│   ├── guards/             # LocalAuthGuard, JwtAuthGuard, Google/Facebook/VkOAuthGuard
│   ├── entities/           # RefreshToken, OAuthAccount
│   ├── enums/              # OAuthProvider
│   └── dto/                # LoginDto, RegisterDto, UpdateProfileDto, VerifyEmailDto, ForgotPasswordDto, ResetPasswordDto
├── audit/
│   ├── audit.service.ts    # AuditService — records 20 security-sensitive actions to audit_logs table
│   └── entities/           # AuditLog entity (action, actorId, actorEmail, targetId, ip, requestId, createdAt)
├── mail/
│   └── mail.service.ts     # Email sending (verification, password reset)
├── roles/
│   ├── controllers/        # RolesController (CRUD + permission + user assignment at /api/v1/roles)
│   ├── services/           # RoleService, PermissionService, PolicyEvaluatorService
│   ├── entities/           # Role, Permission, RolePermission
│   ├── guards/             # PermissionsGuard (resolves + checks typed permissions; admin bypasses)
│   ├── decorators/         # @RequirePermissions([Actions,Subjects]), @Authorize([action,subject]) composite
│   └── casl/               # app-ability.ts (AppAbility, Actions, Subjects, PermissionCheck types)
│                           # CaslAbilityFactory (builds AppAbility, used by AuthController /permissions)
├── users/
│   ├── controllers/        # UsersController (CRUD + search, all endpoints use @Authorize([action, 'User']))
│   ├── services/           # UsersService
│   ├── entities/           # User entity (ManyToMany to Role via user_roles)
│   └── dto/                # CreateUserDto, UpdateUserDto, UserResponseDto (includes roles: string[])
└── feature/
    ├── controllers/        # FeatureController (CRUD, config, upload)
    ├── services/           # FeatureService
    ├── entities/           # FeatureEntity
    ├── guards/             # Example guard
    ├── interceptors/       # Example interceptor (strips sensitive data)
    ├── middlewares/         # Logging middleware
    └── pipes/              # Name validation pipe
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
- **JwtStrategy** — extracts and verifies Bearer token; extracts `roles[]` from payload, computes `isAdmin` from roles
- **GoogleStrategy / FacebookStrategy / VkStrategy** — OAuth2 login (conditionally registered when env vars are set)
- **PermissionsGuard** — resolves user permissions (cached 5 min), checks required permissions from typed `@RequirePermissions([Actions, Subjects])`; admin role bypasses all checks
- **@Authorize([action, subject]) decorator** — composite: `JwtAuthGuard` + `PermissionsGuard` + typed `@RequirePermissions()`. Replaces `@UseGuards(JwtAuthGuard, RolesGuard) @Roles()` pattern
- **CaslAbilityFactory** — builds `AppAbility` from user roles + permissions; used by `AuthController` to return CASL packed rules via `packRules()` from `GET /permissions`
- **JWT payload** — includes `roles: string[]`; `isAdmin` column removed from database (migration `drop-is-admin`)
- **Refresh tokens** — opaque 80-char hex tokens stored in DB (SHA-256 hashed), delivered to the client as an `HttpOnly SameSite=Strict` cookie (`path=/api/v1/auth`), rotated on every use; never appear in response body
- **OAuth accounts** — auto-link by email, manage linked providers, safety check on unlink
- **Token cleanup** — daily cron removes expired tokens, weekly cron removes revoked+expired
- **Account lockout** — 5 failed login attempts → 15 min lock (HTTP 423), admin unlock via user update
- **Email verification** — required before login, 24-hour token expiry, resend capability, OAuth users auto-verified
- **Password reset** — forgot-password/reset-password flow, 1-hour token expiry, invalidates all sessions

### Email (MailModule)

- Uses `nodemailer` for sending verification and password reset emails
- **SMTP transport** when `SMTP_HOST` env var is set (production)
- **Console transport** when `SMTP_HOST` is not set (development) — logs clickable URLs
- Email links use `CLIENT_URL` env var: `${clientUrl}/verify-email?token=xxx`, `${clientUrl}/reset-password?token=xxx`

### Database

Four tables managed via TypeORM migrations:

| Table | Description |
|-------|-------------|
| `users` | UUID PK, email (unique), name, bcrypt password (nullable for OAuth-only), isActive, isEmailVerified, failedLoginAttempts, lockedUntil, verification/reset token fields, `deleted_at TIMESTAMPTZ NULL` (soft delete); ManyToMany to roles via user_roles |
| `oauth_accounts` | UUID PK, provider + provider_id (unique), FK to users (CASCADE) |
| `refresh_tokens` | UUID PK, token (SHA-256 hashed), FK to users (CASCADE), expires_at, revoked |
| `roles` | UUID PK, name (unique), description, isSystem flag |
| `permissions` | UUID PK, resource + action (unique constraint) |
| `role_permissions` | FK to roles + permissions, optional jsonb `conditions` |
| `user_roles` | Join table: user_id + role_id (composite PK) |
| `audit_logs` | UUID PK, action (enum), actorId (nullable), actorEmail (nullable), targetId (nullable), targetType (nullable), details (jsonb), ipAddress, requestId, createdAt |
| `feature` | Auto-increment PK, name, timestamps |

Migration and seed commands operate on compiled JS in `dist/` — always run `npm run build` first.

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

Swagger docs: http://localhost:3000/swagger

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
| POST | `/:id/permissions` | `roles:update` | Assign permissions to role |
| DELETE | `/:id/permissions/:permissionId` | `roles:update` | Remove permission from role |
| POST | `/assign/:userId` | `roles:assign` | Assign role to user |
| DELETE | `/assign/:userId/:roleId` | `roles:assign` | Remove role from user |

### Users (`/api/v1/users`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | `users:create` | Create user |
| GET | `/` | `users:list` | List all users (paginated; `includeDeleted=true` to include soft-deleted) |
| GET | `/search` | `users:search` | Search users (paginated + filters: email, firstName, lastName, isActive; `includeDeleted=true`) |
| GET | `/:id` | `users:read` | Get user by ID |
| PATCH | `/:id` | `users:update` | Update user |
| DELETE | `/:id` | `users:delete` | Soft-delete user (sets `deleted_at`, revokes all active sessions) |
| POST | `/:id/restore` | `users:delete` | Restore soft-deleted user (clears `deleted_at`, sets `isActive=true`) |

**Pagination query params:**
- `page` (default 1)
- `limit` (default 10, max 100)
- `sortBy` (default createdAt)
- `sortOrder` (default desc for list, asc for search)

**Response format for paginated endpoints:**
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

### Feature (`/api/v1/feature`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | None | Returns "Hello World!" |
| GET | `/config` | None | Returns external API config |
| GET | `/entities` | None | List entities (optional `searchTerm` query) |
| POST | `/entities` | None | Create entity (name: max 20 chars, no digits) |
| GET | `/entities/:id` | None | Get entity by ID |
| PATCH | `/entities/:id` | None | Update entity |
| DELETE | `/entities/:id` | None | Delete entity |
| POST | `/upload` | Bearer | Upload files (multipart, field: `upload-artifact`, 5 MB limit, type whitelist) |

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

- **Types**: `UserResponse`, `OAuthAccountResponse`, `TokensResponse`, `AuthResponse`, `PaginationMeta`, `PaginatedResponse<T>`, `SortOrder`; `RoleResponse`, `PermissionResponse`, `RolePermissionResponse`, `RoleWithPermissionsResponse`, `PermissionCondition`, `ResolvedPermission`, `UserPermissionsResponse`
- **Constants**: `PASSWORD_REGEX`, `PASSWORD_ERROR`, `MAX_FAILED_ATTEMPTS`, `LOCKOUT_DURATION_MS`, `MAX_CONCURRENT_SESSIONS`, pagination defaults, user sort columns; `SYSTEM_ROLES`, `SystemRole` (note: `PERMISSIONS` + `Permission` removed — typed `[Actions, Subjects]` tuples used instead)

NestJS build compiles shared files into `dist/shared/` alongside `dist/server/`. Migration and seed scripts use paths like `dist/server/src/...` to reflect the nested output structure.

## Versioning

This package's version is kept in sync with `client/` and `mock-server/` via `commit-and-tag-version`. To cut a release, run `npm run release` from `client/` — it bumps `server/package.json` automatically.

## Tech Stack

| Technology | Version |
|------------|---------|
| NestJS | 11.1.13 |
| TypeORM | 0.3.28 |
| PostgreSQL | via `pg` 8.x |
| Passport | 0.7.x |
| bcrypt | 6.x |
| class-validator | 0.14.x |
| @nestjs/swagger | 11.x |
| @nestjs/schedule | 6.x |
| TypeScript | 5.9.x |
| Jest | 30.x |
| ESLint | 9.x |
| Prettier | 3.x |
