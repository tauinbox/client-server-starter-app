# Fullstack Starter App

Full-stack TypeScript monorepo with **Angular 21** client and **NestJS 11** server, using PostgreSQL via TypeORM. Provides a production-ready foundation with authentication, user management, theming, and an example feature module.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | Angular | 21.1.3 |
| UI Library | Angular Material + CDK | 21.1.3 |
| Backend | NestJS | 11.1.13 |
| Database | PostgreSQL (TypeORM) | 0.3.28 |
| Language | TypeScript | 5.9.x |
| Auth | JWT + Refresh Tokens + OAuth (Passport) | - |
| Client Tests | Vitest (unit), Playwright (e2e) | 4.0.18 / 1.58.2 |
| Server Tests | Jest (unit + e2e) | 30.2.0 |

## Features

### Authentication
- Email/password registration and login
- **Account lockout** — 5 consecutive failed login attempts lock the account for 15 minutes (HTTP 423 with countdown); admin can unlock early via user-edit page
- **Email verification** — new registrations require email verification before login (HTTP 403); resend-verification endpoint; OAuth users auto-verified
- **Password reset** — forgot-password sends a reset link (1-hour token expiry); reset invalidates all active sessions
- **OAuth2 login via Google, Facebook, VK** — auto-links by email, creates OAuth-only users
- JWT access tokens (1h) + opaque refresh tokens (7d)
- Automatic token refresh 60 seconds before expiry
- 401 handling with request retry in JWT interceptor
- Role-based access control (admin/user)
- OAuth account management (link/unlink providers in profile)
- Server-side token cleanup via cron jobs

### User Management (Admin)
- **Server-side paginated** user list with column sorting (page, limit, sortBy, sortOrder query params)
- User detail, edit, and delete
- **Server-side paginated** search by email, name, admin/active status
- Role and status management
- Pagination response envelope: `{ data: User[], meta: { page, limit, total, totalPages } }`

### UI/UX
- Angular Material component library
- Light/dark theme with system preference detection
- Responsive SCSS architecture
- Snackbar error notifications
- Form validation with error messages
- 404 and 403 pages
- Version display in toolbar (version + git hash via `MatTooltip`)

### Versioning
- All three workspaces share a single version (`0.1.0`)
- `client/scripts/version.mjs` auto-generates `src/environments/version.ts` before every build/start/test
- `npm run release` (from `client/`) bumps all `package.json` files, generates `CHANGELOG.md`, and creates a git tag
- Conventional Commits enforced via commitlint + husky `commit-msg` hook

### Example Feature Module
- Demonstrates NestJS patterns: guards, interceptors, middlewares, pipes
- CRUD operations with validation
- File upload with Multer
- Database seeder for sample data

## Project Structure

```
fullstack-starter-app/
├── .github/workflows/      # CI/CD pipeline (GitHub Actions)
│   └── ci.yml              # Lint, test, build on push/PR to master
├── shared/                 # Shared types and constants (no build step)
│   ├── tsconfig.json       # Minimal config for IDE support
│   └── src/
│       ├── types/          # UserResponse, AuthResponse, PaginatedResponse<T>, etc.
│       ├── constants/      # PASSWORD_REGEX, pagination defaults, etc.
│       └── index.ts        # Barrel exports
├── client/                 # Angular 21 SPA
│   ├── src/app/
│   │   ├── core/           # Header, theme, storage, error interceptor, 404
│   │   ├── features/
│   │   │   ├── auth/       # Login, register, profile, verify-email, forgot/reset-password, guards, JWT interceptor
│   │   │   ├── users/      # User list, detail, edit, search
│   │   │   └── feature/    # Example feature
│   │   └── shared/         # Shared components (confirm dialog)
│   ├── src/styles/         # SCSS architecture (themes, utilities, components)
│   └── e2e/                # Playwright E2E tests (uses mock-server)
├── server/                 # NestJS 11 API
│   ├── src/modules/
│   │   ├── core/           # Config, caching, database, scheduling
│   │   ├── auth/           # JWT + refresh token auth, lockout, verification, reset
│   │   ├── mail/           # Email delivery (nodemailer, console/SMTP transports)
│   │   ├── users/          # User CRUD
│   │   └── feature/        # Example module
│   ├── src/migrations/     # TypeORM migrations
│   └── src/seeders/        # Database seeders
├── mock-server/            # In-memory Express server for dev/testing
│   └── src/
│       ├── index.ts        # Server entry point
│       ├── app.ts          # Express app factory (createApp)
│       ├── state.ts        # In-memory state management
│       ├── seed.ts         # Faker-based seed data (70 users)
│       ├── factories.ts    # createMockUser, createOAuthAccount
│       ├── jwt.utils.ts    # JWT generation/validation
│       ├── middleware/      # Route handlers (auth, users, OAuth) + guards
│       ├── helpers/        # Auth helper utilities
│       └── control.routes.ts  # Test control API (reset, seed)
└── doc/                    # Project documentation
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
| `SMTP_FROM` | `noreply@example.com` | Default "from" address for emails |

### 3. Set up the database

```bash
cd server
npm run build
npm run migrations:run
npm run seed:run            # Optional: seed 100 sample entities
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

## API Documentation

Swagger docs are available at http://localhost:3000/swagger when the server is running.

API base URL: `/api/v1`

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | None | Register a new user |
| POST | `/auth/login` | None | Login, returns JWT + refresh token |
| POST | `/auth/refresh-token` | None | Refresh access token |
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
| GET | `/users` | Admin | List all users (paginated: page, limit, sortBy, sortOrder) |
| GET | `/users/search` | Admin | Search users by criteria (paginated + filters) |
| GET | `/users/:id` | Admin | Get user by ID |
| PATCH | `/users/:id` | Admin | Update user |
| DELETE | `/users/:id` | Admin | Delete user |
| GET | `/feature` | None | Example endpoint |
| GET | `/feature/entities` | None | List feature entities |
| POST | `/feature/entities` | None | Create feature entity |
| POST | `/feature/upload` | Bearer | Upload files (5 MB limit, type whitelist) |

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
npm run migrations:gen     # Generate migration (build first)
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
- **Guards**: `authGuard` (checks authentication + token refresh) and `adminGuard` (checks admin role)
- **Path aliases**: `@core/*`, `@features/*`, `@shared/*`

### Server

- **Modular NestJS architecture** with dynamic root `CoreModule`
- **Passport strategies**: `LocalStrategy` (email/password), `JwtStrategy` (Bearer token), `GoogleStrategy`, `FacebookStrategy`, `VkStrategy` (OAuth, conditionally registered)
- **Request pipeline**: Global middleware -> Module middleware -> Guards -> Interceptors -> Pipes -> Controller
- **Pagination**: Common `PaginationQueryDto` and `PaginatedResponseDto<T>` for consistent server-side pagination across endpoints
- **Cron jobs**: Daily expired token cleanup, weekly revoked token cleanup
- **Swagger** auto-generated API documentation

### Database

Four tables managed via TypeORM migrations:

- **users** — UUID primary key, email (unique), name, bcrypt password hash (nullable for OAuth-only users), role/active flags, email verification (isEmailVerified, token, expiresAt), account lockout (failedLoginAttempts, lockedUntil), password reset (token, expiresAt)
- **oauth_accounts** — Linked to users (CASCADE delete), provider + provider_id (unique), timestamps
- **refresh_tokens** — Linked to users (CASCADE delete), token string (SHA-256 hashed), expiry, revoked flag
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
| Server unit tests | Jest | `*.spec.ts` alongside source | 150 tests passing |
| Server E2E tests | Jest | Separate config in `test/` | Configured |
| Client unit tests | Vitest | `*.spec.ts` alongside source | 154 tests passing |
| Client E2E tests | Playwright | `e2e/` directory, uses mock-server (in-memory Express API) | 113 tests passing |
| Mock server | Express | `mock-server/` directory, provides full API simulation with pagination support | In use |

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

- Passwords hashed with **bcrypt** (salt rounds = 10)
- **Account lockout** after 5 failed login attempts (15-minute cooldown)
- **Email verification** required before first login
- **Password reset tokens** are single-use with 1-hour expiry; reset revokes all sessions
- JWT access tokens (1h) + opaque refresh tokens (7d) with rotation
- `@Exclude()` decorator hides password in API responses
- `class-validator` on server DTOs, Angular `Validators` on client forms
- LIKE query pattern escaping to prevent SQL injection via wildcards
- File upload security: auth required, 5 MB limit, type whitelist, filename sanitization
- Configurable CORS (permissive only in `local` environment)
- Angular template escaping for XSS prevention

