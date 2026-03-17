# Fullstack Starter App

Full-stack TypeScript monorepo with **Angular 21** client and **NestJS 11** server, using PostgreSQL via TypeORM. Provides a production-ready foundation with authentication, user management, and theming.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | Angular | 21.2.1 |
| UI Library | Angular Material + CDK | 21.2.1 |
| Backend | NestJS | 11.1.16 |
| Database | PostgreSQL (TypeORM) | 0.3.28 |
| Language | TypeScript | 5.9.x |
| Auth | JWT + HttpOnly-cookie refresh tokens + OAuth (Passport) | - |
| Client Tests | Vitest (unit), Playwright (e2e) | 4.0.18 / 1.58.2 |
| Server Tests | Jest (unit + e2e) | 30.2.0 |

## Features

### Authentication
- Email/password registration and login
- **Account lockout** — 5 consecutive failed login attempts lock the account for 15 minutes (HTTP 423 with countdown); admin can unlock early via user-edit page
- **Email verification** — new registrations require email verification before login (HTTP 403); resend-verification endpoint; OAuth users auto-verified
- **Password reset** — forgot-password sends a reset link (1-hour token expiry); reset invalidates all active sessions
- **OAuth2 login via Google, Facebook, VK** — auto-links by email, creates OAuth-only users
- JWT access tokens (1h, stored in-memory only) + opaque refresh tokens (7d, stored as HttpOnly `SameSite=Strict` cookie — never readable by JavaScript)
- Session restored on page reload via cookie-refresh in `provideAppInitializer` before route guards run
- Automatic token refresh 60 seconds before expiry
- 401 handling with request retry in JWT interceptor
- **Role-Based Access Control (RBAC)** — dynamic resources and actions with `@RegisterResource` auto-discovery; `isSuper` flag on roles replaces hardcoded admin bypass; `@Authorize(['action', 'Subject'])` typed tuples on server; `permissionGuard(action, subject)` + `*appRequirePermissions="{ action, subject }"` directive on client; `/api/v1/rbac/` endpoints for managing resources and actions
- `GET /api/v1/auth/permissions` returns CASL packed rules; client hydrates into `AppAbility` at bootstrap before route activation
- OAuth account management (link/unlink providers in profile)
- Server-side token cleanup via cron jobs
- **Audit logging** — security-sensitive operations recorded to `audit_logs` table (login, registration, password changes, user/role management, OAuth events); nightly cleanup removes entries older than `AUDIT_LOG_RETENTION_DAYS` days (default 90)

### Admin Panel
- **Role management** — tabbed `/admin` shell (`AdminPanelComponent`) with "Users", "Roles", and "Resources" tabs. Role list with create/edit/delete dialogs; `RolePermissionsDialogComponent` assigns permissions to roles with optional CASL conditions (ownership, fieldMatch, userAttr, custom)
- **Resource/Action management** — "Manage Resources" tab at `/admin/resources` (requires `read:Permission`). Resources table allows editing display name, description, and allowed actions per resource (`allowedActionNames`); Actions table supports create, edit, and delete of non-default actions. Each mutation refreshes `RbacMetadataStore` automatically
- **CASL condition editors** — all four condition types supported in the permissions dialog: `ownership` checkbox, `fieldMatch` / `userAttr` JSON editors, and a `custom` raw MongoQuery textarea with blur-time JSON validation
- **Prototype-pollution-safe `custom` conditions** — `CaslAbilityFactory` uses `Object.entries()` loop instead of `Object.assign` when merging user-supplied JSON into the CASL query object

### User Management (Admin)
- **Unified Manage Users page** — inline filter form (email, first/last name, status) on the same page as the user list; empty filters load all users, filled filters trigger a search via `GET /users/search`
- **Infinite scroll** with column sorting — loads 20 users at a time; `IntersectionObserver` sentinel triggers additional pages automatically as the user scrolls
- User detail, edit, and **soft delete** — records are preserved with a `deleted_at` timestamp; all active sessions are revoked on delete; count decremented inline (no reload)
- **Restore** soft-deleted users via `POST /users/:id/restore` — reactivates the account
- `includeDeleted=true` query param shows soft-deleted users in list and search
- Role assignment in user edit form — multi-select field (visible to users with `assign:Role` permission); diffs initial vs selected roles and issues `POST /roles/assign/:userId` / `DELETE /roles/assign/:userId/:roleId` calls on save
- Pagination response envelope: `{ data: User[], meta: { page, limit, total, totalPages } }`
- **Sticky header** — toolbar remains fixed at the top while scrolling through long lists

### UI/UX
- Angular Material component library
- Light/dark theme with system preference detection
- Responsive SCSS architecture
- Snackbar error notifications
- Form validation with error messages
- 404 and 403 pages
- Version display in toolbar (version + git hash via `MatTooltip`)
- **Collapsible side navigation** — persistent left panel (narrow 64px / wide 220px) with per-user localStorage persistence
- **Standardized dialog system** — `DialogSize` enum (`Confirm` / `Form` / `Wide`) with `dialogSizeConfig()` helper; all dialogs use Material Design 3 responsive `{ width: '90vw', maxWidth }` pattern; global `_dialogs.scss` handles title padding, Angular Material bug #26352 fix (floating label clipping), and `::before` spacer reset

### Versioning
- All three workspaces share a single version (`0.1.0`)
- `client/scripts/version.mjs` auto-generates `src/environments/version.ts` before every build/start/test
- `npm run release` (from `client/`) bumps all `package.json` files, generates `CHANGELOG.md`, and creates a git tag
- Conventional Commits enforced via commitlint + husky `commit-msg` hook

## Project Structure

```
fullstack-starter-app/
├── .github/workflows/      # CI/CD pipeline (GitHub Actions)
│   └── ci.yml              # Lint, test, build on push/PR to master
├── shared/                 # Shared types and constants (no build step)
│   ├── tsconfig.json       # Minimal config for IDE support
│   └── src/
│       ├── types/          # UserResponse, AuthResponse, PaginatedResponse<T>, RoleResponse,
│       │                   # PermissionResponse, UserPermissionsResponse, etc.
│       ├── constants/      # PASSWORD_REGEX, pagination defaults, SYSTEM_ROLES, MAX_CONCURRENT_SESSIONS, etc.
│       └── index.ts        # Barrel exports
├── client/                 # Angular 21 SPA
│   ├── src/app/
│   │   ├── core/           # Header, theme, storage, error interceptor, 404
│   │   ├── features/
│   │   │   ├── auth/       # Login, register, profile, verify-email, forgot/reset-password, guards, JWT interceptor
│   │   │   ├── users/      # User list (with inline filters), detail, edit
│   │   │   └── admin/      # Admin panel shell, role/resource management dialogs, RolesStore, ResourcesStore
│   │   └── shared/         # Shared components (confirm dialog)
│   ├── src/styles/         # SCSS architecture (themes, utilities, components)
│   └── e2e/                # Playwright E2E tests (uses mock-server)
├── server/                 # NestJS 11 API
│   ├── src/modules/
│   │   ├── core/           # Config, caching, database, scheduling
│   │   ├── auth/           # JWT + refresh token auth, lockout, verification, reset, permissions endpoint
│   │   ├── mail/           # Email delivery (nodemailer, console/SMTP transports)
│   │   ├── users/          # User CRUD
│   │   └── roles/          # RBAC: Role/Permission/RolePermission entities, RolesController, PermissionsGuard
│   ├── src/common/
│   │   ├── dtos/           # PaginationQueryDto, PaginatedResponseDto<T>
│   │   ├── utils/          # escapeLikePattern, hashToken, withTransaction, extractAuditContext
│   │   └── upload/         # createDiskStorageOptions() — reusable multer disk storage factory
│   ├── src/migrations/     # TypeORM migrations
│   └── src/seeders/        # Database seeders
└── mock-server/            # In-memory Express server for dev/testing
    └── src/
        ├── index.ts        # Server entry point
        ├── app.ts          # Express app factory (createApp)
        ├── state.ts        # In-memory state management
        ├── seed.ts         # Faker-based seed data (70 users)
        ├── factories.ts    # createMockUser, createOAuthAccount
        ├── jwt.utils.ts    # JWT generation/validation
        ├── middleware/      # Route handlers (auth, users, OAuth) + guards
        ├── helpers/        # Auth helper utilities
        └── control.routes.ts  # Test control API (reset, seed)
```

All three workspaces import from `@app/shared/*` path alias (maps to `../shared/src/*` in each workspace's `tsconfig.json`).

## Prerequisites

- **Node.js 22** (pinned via `.nvmrc`)
- **PostgreSQL** running locally or remotely
- **npm**

## Getting Started

### 1. Clone and install dependencies

```bash
git clone <repository-url>
cd fullstack-starter-app

cd client && npm install        # also activates git hooks (husky)
cd ../server && npm install
cd ../mock-server && npm install
```

### 2. Configure the server

```bash
cd server
cp .env.example .env
```

Edit `.env` with your database credentials and settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `APPLICATION_PORT` | `3000` | HTTP listen port |
| `ENVIRONMENT` | `local` | Environment name |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `my-db` | Database name |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | `password` | Database password |
| `JWT_SECRET` | `my_jwt_secret_key` | Secret for signing JWTs |
| `JWT_EXPIRATION` | `3600` | Access token lifetime (seconds) |
| `JWT_REFRESH_EXPIRATION` | `604800` | Refresh token lifetime (seconds) |
| `GOOGLE_CLIENT_ID` | - | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | - | Google OAuth client secret |
| `FACEBOOK_CLIENT_ID` | - | Facebook OAuth client ID |
| `FACEBOOK_CLIENT_SECRET` | - | Facebook OAuth client secret |
| `VK_CLIENT_ID` | - | VK OAuth client ID |
| `VK_CLIENT_SECRET` | - | VK OAuth client secret |
| `CLIENT_URL` | `http://localhost:4200` | Client URL for OAuth redirects |
| `SMTP_HOST` | - | SMTP server host (enables email delivery) |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | - | SMTP username |
| `SMTP_PASS` | - | SMTP password |
| `REDIS_URL` | - | Redis connection URL (optional; enables distributed rate limiting and shared permission cache for multi-instance deployments) |
| `AUDIT_LOG_RETENTION_DAYS` | `90` | Days to retain audit log entries |
| `DB_POOL_MAX` | `10` | Maximum PostgreSQL connection pool size |
| `DB_POOL_IDLE_TIMEOUT` | `30000` | Milliseconds before an idle connection is closed |
| `DB_POOL_CONNECTION_TIMEOUT` | `5000` | Milliseconds to wait for a connection before erroring |
| `SMTP_FROM` | `noreply@example.com` | Default "from" address for emails |
| `ADMIN_EMAIL` | - | Email for the initial admin user (seeded on startup; skip if empty) |
| `ADMIN_PASSWORD` | - | Password for the initial admin user |
| `ADMIN_FIRST_NAME` | `Admin` | First name for the initial admin user |
| `ADMIN_LAST_NAME` | `User` | Last name for the initial admin user |

### 3. Set up the database

```bash
cd server
npm run build
npm run migrations:run
npm run seed:run            # Optional: seed initial admin and RBAC data
```

### 4. Start development servers

**Option 1: Full stack (NestJS server with PostgreSQL)**

```bash
# Terminal 1 — Backend (port 3000)
cd server
npm run start:dev

# Terminal 2 — Frontend (port 4200, proxies /api to backend)
cd client
npm start
```

**Option 2: Mock server (no database required, great for frontend development)**

```bash
# Terminal 1 — Mock backend (port 3000, in-memory data, watch mode)
cd mock-server
npm run start:dev

# Terminal 2 — Frontend (port 4200, proxies /api to mock server)
cd client
npm start
```

Open http://localhost:4200 in your browser.

**Mock server credentials:**
- Admin: `admin@example.com` / `Password1`
- User: `user@example.com` / `Password1`

## Docker Deployment

The project ships with Dockerfiles and a Compose file for production deployment.

### Build and run

```bash
# Build all images
docker-compose build

# Start all services (PostgreSQL, server, client)
docker-compose up -d
```

Services:
- **redis** — redis:7-alpine, used for distributed rate limiting and shared permission cache
- **db** — postgres:17-alpine, persistent named volume; port 5432 exposed to host for local development
- **server** — NestJS API on port 3000; entrypoint runs migrations, optional admin seed, then starts the server
- **client** — Angular SPA served by nginx on port 4200 (maps to container port 80); built with `--base-href /nexus/` (overridable via `docker build --build-arg BASE_HREF=/`)

### Docker environment variables

In addition to the standard server env vars, set these in `server/.env` to provision an initial admin account on first startup:

```
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=YourSecurePass1
ADMIN_FIRST_NAME=Admin
ADMIN_LAST_NAME=User
```

The admin seeder is idempotent — it skips creation if the user already exists and does nothing if `ADMIN_EMAIL` is empty.

### Deploy pipeline

`.github/workflows/deploy.yml` — triggered manually (`workflow_dispatch`) or on push to `master`. Builds and pushes Docker images to a container registry.

---

## API Documentation

Swagger docs are available at http://localhost:3000/swagger when the server is running.

API base URL: `/api/v1`

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | None | Register a new user |
| POST | `/auth/login` | None | Login — sets `refresh_token` HttpOnly cookie, returns access token |
| POST | `/auth/refresh-token` | None | Refresh access token (reads `refresh_token` cookie, rotates cookie) |
| POST | `/auth/logout` | Bearer | Logout, revokes refresh tokens |
| GET | `/auth/profile` | Bearer | Get current user profile |
| PATCH | `/auth/profile` | Bearer | Update own profile (name, password) |
| GET | `/auth/oauth/:provider` | None | Initiate OAuth login (google, facebook, vk) |
| GET | `/auth/oauth/:provider/callback` | None | OAuth provider callback |
| POST | `/auth/verify-email` | None | Verify email with token |
| POST | `/auth/resend-verification` | None | Resend verification email |
| POST | `/auth/forgot-password` | None | Request password reset email |
| POST | `/auth/reset-password` | None | Reset password with token |
| GET | `/auth/oauth/accounts` | Bearer | List linked OAuth accounts |
| DELETE | `/auth/oauth/accounts/:provider` | Bearer | Unlink OAuth provider |
| GET | `/auth/permissions` | Bearer | Get current user's resolved permissions |
| GET | `/users` | `users:search` | List all users (paginated; `includeDeleted=true` to include soft-deleted) |
| GET | `/users/search` | `users:search` | Search users (paginated + filters: email, firstName, lastName, isActive; `includeDeleted=true`) |
| GET | `/users/:id` | `users:read` | Get user by ID |
| POST | `/users` | `users:create` | Create user |
| PATCH | `/users/:id` | `users:update` | Update user |
| DELETE | `/users/:id` | `users:delete` | Soft-delete user (sets `deleted_at`, revokes sessions) |
| POST | `/users/:id/restore` | `users:delete` | Restore soft-deleted user (clears `deleted_at`, sets `isActive=true`) |
| POST | `/roles` | `roles:create` | Create role |
| GET | `/roles` | `roles:read` | List roles with permissions |
| GET | `/roles/:id` | `roles:read` | Get role by ID |
| PATCH | `/roles/:id` | `roles:update` | Update role |
| DELETE | `/roles/:id` | `roles:delete` | Delete role |
| GET | `/roles/permissions` | `roles:read` | List all available permissions |
| GET | `/roles/:id/permissions` | `roles:read` | Get permissions assigned to a specific role |
| PUT | `/roles/:id/permissions` | `roles:update` | Bulk-replace the full permission set for a role |
| POST | `/roles/:id/permissions` | `roles:update` | Assign permissions to role |
| DELETE | `/roles/:id/permissions/:permId` | `roles:update` | Remove permission from role |
| POST | `/roles/assign/:userId` | `roles:assign` | Assign role to user |
| DELETE | `/roles/assign/:userId/:roleId` | `roles:assign` | Remove role from user |
| GET | `/rbac/metadata` | Bearer | Get RBAC metadata (resources + actions); Redis-cached 60s |
| GET | `/rbac/resources` | `permissions:read` | List all resources |
| PATCH | `/rbac/resources/:id` | `permissions:update` | Update resource display info |
| GET | `/rbac/actions` | `permissions:read` | List all actions |
| POST | `/rbac/actions` | `permissions:create` | Create a new action |
| PATCH | `/rbac/actions/:id` | `permissions:update` | Update action |
| DELETE | `/rbac/actions/:id` | `permissions:delete` | Delete custom action |

## Available Commands

### Mock Server (`cd mock-server`)

```bash
npm start                  # Start mock server (port 3000)
npm run start:dev          # Start with watch mode (ts-node-dev)
npm run lint               # Lint check
npm run format:check       # Prettier check
```

### Server (`cd server`)

```bash
npm run start:dev          # Dev server (port 3000, watch mode)
npm run build              # Production build
npm run lint               # Lint check
npm run lint:fix           # Lint and auto-fix
npm run format:check       # Prettier check
npm run format             # Prettier format
npm test                   # Unit tests (Jest)
npm run test:cov           # Test coverage
npm run test:e2e           # E2E tests
npm run migrations:run     # Run migrations (build first)
npm run migrations:gen -- ./src/migrations/<kebab-name>  # Generate migration (build first)
npm run seed:run           # Run seeders (build first)
```

### Client

```bash
npm start                  # Dev server (port 4200, proxy to backend)
npm run build              # Production build
npm run lint               # Lint check
npm test                   # Unit tests (Vitest)
npm run test:e2e           # E2E tests (Playwright, uses mock-server)
npm run test:e2e:ui        # E2E tests (interactive UI)
npm run release            # Bump versions, generate CHANGELOG.md, create git tag
```

## Architecture

### Client

- **Standalone components** (no NgModules), all using `OnPush` change detection
- **Lazy loading** via `loadComponent` on all routes
- **NgRx Signal Store** for state management (`AuthStore` global, `UsersStore` route-level)
- **HTTP interceptors**: JWT (auto-attach token, handle 401 refresh) and error (snackbar notifications)
- **Guards**: `authGuard` (checks authentication + token refresh), `permissionGuard(action, subject)` (typed CASL check for route-level access), `adminPanelGuard` (OR check: search/User OR read/Role OR read/Permission), `guestGuard` (redirects authenticated users); `PermissionsGuard` checks RBAC permissions on server
- **Path aliases**: `@core/*`, `@features/*`, `@shared/*`

### Server

- **Modular NestJS architecture** with dynamic root `CoreModule`
- **Passport strategies**: `LocalStrategy` (email/password), `JwtStrategy` (Bearer token; extracts roles, computes isAdmin), `GoogleStrategy`, `FacebookStrategy`, `VkStrategy` (OAuth, conditionally registered)
- **RBAC**: `RolesModule` provides `PermissionsGuard`, `PolicyEvaluatorService`, `PermissionService`, `CaslAbilityFactory`. `@Authorize(['action', 'Subject'])` typed tuples replace `@UseGuards(JwtAuthGuard, RolesGuard) @Roles()` on all protected endpoints
- **Request pipeline**: Global middleware -> Module middleware -> Guards -> Interceptors -> Pipes -> Controller
- **Pagination**: Common `PaginationQueryDto` and `PaginatedResponseDto<T>` for consistent server-side pagination across endpoints
- **Cron jobs**: Daily expired token cleanup, weekly revoked token cleanup
- **Swagger** auto-generated API documentation

### Database

Nine tables managed via TypeORM migrations:

- **users** — UUID primary key, email (unique), name, bcrypt password hash (nullable for OAuth-only users), role/active flags, email verification (isEmailVerified, token, expiresAt), account lockout (failedLoginAttempts, lockedUntil), password reset (token, expiresAt), soft delete (`deleted_at TIMESTAMPTZ NULL`); ManyToMany to roles via user_roles
- **oauth_accounts** — Linked to users (CASCADE delete), provider + provider_id (unique), timestamps
- **refresh_tokens** — Linked to users (CASCADE delete), token string (SHA-256 hashed), expiry, revoked flag
- **roles** — UUID PK, name (unique), description, isSystem flag, isSuper flag; ManyToMany with users
- **resources** — UUID PK, name (unique), displayName, description, isSystem flag, `allowed_action_names text[]` (null = use all default actions)
- **actions** — UUID PK, name (unique), displayName, description, isSystem flag, sortOrder
- **permissions** — UUID PK, resource_id + action_id (unique constraint, FKs to resources and actions)
- **role_permissions** — FK to roles + permissions, optional jsonb `conditions` column
- **user_roles** — Join table (user_id, role_id), composite PK
- **feature** — Auto-increment ID, name, timestamps

## Code Quality

| Tool | Scope | Config |
|------|-------|--------|
| ESLint | Client (angular-eslint, unused-imports, import cycles) | `eslint.config.mjs` |
| ESLint | Server (@typescript-eslint + prettier) | `eslint.config.ts` |
| Prettier | Both (single quotes, no trailing commas) | `.prettierrc` |
| Stylelint | Client SCSS (recess property order) | `.stylelintrc.json` |
| Husky + lint-staged | Pre-commit hook (auto-fix staged files) | `.lintstagedrc.mjs` |
| Commitlint | Conventional Commits enforcement | `client/commitlint.config.mjs` |
| commit-and-tag-version | Automated versioning + CHANGELOG | `client/.versionrc.json` |

### Git Hooks

A pre-commit hook (via [husky](https://typicode.github.io/husky/)) runs **lint-staged** on every commit. It applies auto-fix linting to staged files only:

| Glob | Linter |
|------|--------|
| `client/{src,e2e}/**/*.ts` | ESLint (angular-eslint + prettier) |
| `client/src/**/*.scss` | Stylelint |
| `server/src/**/*.ts` | Prettier + ESLint (@typescript-eslint) |
| `mock-server/src/**/*.ts` | Prettier + ESLint (@typescript-eslint) |

A commit-msg hook (`client/.husky/commit-msg`) additionally runs **commitlint** to enforce [Conventional Commits](https://www.conventionalcommits.org/) format.

Husky, lint-staged, and commitlint are installed in the `client/` sub-package. Running `npm install` inside `client/` activates the git hooks via the `prepare` script.

## Testing

| Type | Tool | Scope | Status |
|------|------|-------|--------|
| Server unit tests | Jest | `*.spec.ts` alongside source | 404 tests passing |
| Server E2E tests | Jest | Separate config in `test/` | Configured |
| Client unit tests | Vitest | `*.spec.ts` alongside source | 351 tests passing |
| Client E2E tests | Playwright | `e2e/` directory, uses mock-server (4 parallel workers) | 101 tests passing |
| Mock server | Express | `mock-server/` directory, provides full API simulation with RBAC support | In use |

## CI/CD

GitHub Actions runs on every push and pull request to `master` with 4 parallel jobs:

| Job | Steps | Artifacts |
|-----|-------|-----------|
| **Server** | lint, format:check, test:cov (60/60/50/60 thresholds), build | Coverage report |
| **Mock Server** | lint, format:check | - |
| **Client** | lint, unit test, build | - |
| **Client E2E** (needs: mock-server) | Playwright with Chromium caching | HTML report, test results |

Concurrency groups cancel stale runs on rapid pushes. No database or `.env` file required — all tests run against mocks.

## Security

- Passwords hashed with **bcrypt** (cost factor = 12)
- **Account lockout** after 5 failed login attempts (15-minute cooldown)
- **Email verification** required before first login
- **Password reset tokens** are single-use with 1-hour expiry; reset revokes all sessions
- **HttpOnly refresh token cookie** (`SameSite=Strict`, `path=/api/v1/auth`, 7d expiry) — JavaScript cannot read or steal the token (XSS-proof); rotated on every use
- JWT access tokens (1h) stored in Angular signals only — never written to `localStorage`; user info persisted to `localStorage` (`auth_user` key) only to detect prior sessions on page reload
- `@Exclude()` decorator hides password in API responses
- **RBAC** — dynamic resources and actions with `@RegisterResource` auto-discovery; typed CASL permission checks via `PermissionsGuard` + `@Authorize(['action', 'Subject'])`; CASL ability hydrated at bootstrap before route activation; permissions cached per user (5 min); `isSuper` flag on roles bypasses all checks; `*appRequirePermissions="{ action, subject }"` directive for template-level visibility
- **Audit logging** — 20 security-sensitive actions (login, register, password change/reset, user/role/permission CRUD, OAuth link/unlink, logout, token refresh failures) written to a dedicated `audit_logs` table with actor, target, IP, and request ID
- `class-validator` on server DTOs, Angular `Validators` on client forms
- LIKE query pattern escaping to prevent SQL injection via wildcards
- File upload security: auth required, 5 MB limit, type whitelist, filename sanitization
- Configurable CORS (permissive only in `local` environment)
- Angular template escaping for XSS prevention

