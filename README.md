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
| Auth | JWT + Refresh Tokens (Passport) | - |
| Client Tests | Vitest (unit), Playwright (e2e) | 4.0.18 / 1.58.2 |
| Server Tests | Jest (unit + e2e) | 30.2.0 |

## Features

### Authentication
- Email/password registration and login
- JWT access tokens (1h) + opaque refresh tokens (7d)
- Automatic token refresh 60 seconds before expiry
- 401 handling with request retry in JWT interceptor
- Role-based access control (admin/user)
- Server-side token cleanup via cron jobs

### User Management (Admin)
- Paginated user list with column sorting
- User detail, edit, and delete
- Search by email, name, admin/active status
- Role and status management

### UI/UX
- Angular Material component library
- Light/dark theme with system preference detection
- Responsive SCSS architecture
- Snackbar error notifications
- Form validation with error messages
- 404 and 403 pages

### Example Feature Module
- Demonstrates NestJS patterns: guards, interceptors, middlewares, pipes
- CRUD operations with validation
- File upload with Multer
- Database seeder for sample data

## Project Structure

```
fullstack-starter-app/
├── client/                 # Angular 21 SPA
│   ├── src/app/
│   │   ├── core/           # Header, theme, storage, 404
│   │   ├── features/
│   │   │   ├── auth/       # Login, register, profile, guards, interceptors
│   │   │   ├── users/      # User list, detail, edit, search
│   │   │   └── feature/    # Example feature
│   │   └── shared/         # Shared components (confirm dialog)
│   ├── src/styles/         # SCSS architecture (themes, utilities, components)
│   └── e2e/                # Playwright E2E tests
├── server/                 # NestJS 11 API
│   ├── src/modules/
│   │   ├── core/           # Config, caching, database, scheduling
│   │   ├── auth/           # JWT + refresh token auth (Passport strategies)
│   │   ├── users/          # User CRUD
│   │   └── feature/        # Example module
│   ├── src/migrations/     # TypeORM migrations
│   └── src/seeders/        # Database seeders
└── doc/                    # Project documentation
```

## Prerequisites

- **Node.js** (see `package.json` engines)
- **PostgreSQL** running locally or remotely
- **npm**

## Getting Started

### 1. Clone and install dependencies

```bash
git clone <repository-url>
cd fullstack-starter-app

cd client && npm install   # also activates git hooks (husky)
cd ../server && npm install
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

### 3. Set up the database

```bash
cd server
npm run build
npm run migrations:run
npm run seed:run            # Optional: seed 100 sample entities
```

### 4. Start development servers

```bash
# Terminal 1 — Backend (port 3000)
cd server
npm run start:dev

# Terminal 2 — Frontend (port 4200, proxies /api to backend)
cd client
npm start
```

Open http://localhost:4200 in your browser.

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
| GET | `/users` | Admin | List all users |
| GET | `/users/search` | Admin | Search users by criteria |
| GET | `/users/:id` | Bearer | Get user by ID |
| PATCH | `/users/:id` | Bearer | Update user |
| DELETE | `/users/:id` | Admin | Delete user |
| GET | `/feature` | None | Example endpoint |
| GET | `/feature/entities` | None | List feature entities |
| POST | `/feature/entities` | None | Create feature entity |
| POST | `/feature/upload` | None | Upload files |

## Available Commands

### Server

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
npm run test:e2e           # E2E tests (Playwright)
npm run test:e2e:ui        # E2E tests (interactive UI)
```

## Architecture

### Client

- **Standalone components** (no NgModules), all using `OnPush` change detection
- **Lazy loading** via `loadComponent` on all routes
- **Angular Signals** for state management (no centralized store)
- **HTTP interceptors**: JWT (auto-attach token, handle 401 refresh) and error (snackbar notifications)
- **Guards**: `authGuard` (checks authentication + token refresh) and `adminGuard` (checks admin role)
- **Path aliases**: `@core/*`, `@features/*`, `@shared/*`

### Server

- **Modular NestJS architecture** with dynamic root `CoreModule`
- **Passport strategies**: `LocalStrategy` (email/password) and `JwtStrategy` (Bearer token)
- **Request pipeline**: Global middleware -> Module middleware -> Guards -> Interceptors -> Pipes -> Controller
- **Cron jobs**: Daily expired token cleanup, weekly revoked token cleanup
- **Swagger** auto-generated API documentation

### Database

Three tables managed via TypeORM migrations:

- **users** — UUID primary key, email (unique), name, bcrypt password hash, role/active flags
- **refresh_tokens** — Linked to users (CASCADE delete), token string, expiry, revoked flag
- **feature** — Auto-increment ID, name, timestamps

## Code Quality

| Tool | Scope | Config |
|------|-------|--------|
| ESLint | Client (angular-eslint, unused-imports, import cycles) | `eslint.config.mjs` |
| ESLint | Server (@typescript-eslint + prettier) | `eslint.config.mjs` |
| Prettier | Both (single quotes, no trailing commas) | `.prettierrc` |
| Stylelint | Client SCSS (recess property order) | `.stylelintrc.json` |
| Husky + lint-staged | Pre-commit hook (auto-fix staged files) | `.lintstagedrc.mjs` |

### Git Hooks

A pre-commit hook (via [husky](https://typicode.github.io/husky/)) runs **lint-staged** on every commit. It applies auto-fix linting to staged files only:

| Glob | Linter |
|------|--------|
| `client/src/**/*.ts` | ESLint (angular-eslint) |
| `client/src/**/*.scss` | Stylelint |
| `server/src/**/*.ts` | ESLint (@typescript-eslint) |

Husky and lint-staged are installed in the `client/` sub-package. Running `npm install` inside `client/` activates the git hooks via the `prepare` script.

## Testing

| Type | Tool | Scope |
|------|------|-------|
| Server unit tests | Jest | `*.spec.ts` alongside source |
| Server E2E tests | Jest | Separate config in `test/` |
| Client unit tests | Vitest | `*.spec.ts` alongside source |
| Client E2E tests | Playwright | `e2e/` directory, API mocking via route interception |

## Security

- Passwords hashed with **bcrypt** (salt rounds = 10)
- JWT access tokens (1h) + opaque refresh tokens (7d) with rotation
- `@Exclude()` decorator hides password in API responses
- `class-validator` on server DTOs, Angular `Validators` on client forms
- Configurable CORS (permissive only in `local` environment)
- Angular template escaping for XSS prevention

