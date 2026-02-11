# Project Status

**Last updated:** 2026-02-11
**Current branch:** `master`
**Latest commit:** NgRx Signal Store integration (AuthStore + UsersStore)

---

## Overall Status: Active Development

The project is a functional full-stack application with authentication, user management, theming, and an example feature module. Recent work has focused on code quality tooling, testing infrastructure, and auth module refactoring.

---

## Module Status

### Server (NestJS 11)

| Module | Status | Notes |
|--------|--------|-------|
| Core (bootstrap, config, DB) | Done | TypeORM + PostgreSQL configured |
| Auth (JWT + refresh tokens) | Done | Login, register, logout, refresh, profile. Token cleanup via cron |
| Users (CRUD) | Done | List, search, get, update, delete. Role-based access |
| Feature (example) | Done | CRUD, file upload, guards, interceptors, middlewares, pipes |
| Swagger docs | Done | Available at `/swagger` |
| Migrations | Done | 3 migrations: feature, users, refresh_tokens |
| Seeders | Done | 100 sample feature entities |

### Client (Angular 21)

| Module | Status | Notes |
|--------|--------|-------|
| Auth (login, register, profile) | Done | JWT interceptor, auto-refresh, guards. NgRx Signal Store (`AuthStore`) |
| Users (list, detail, edit, search) | Done | Admin-only access, pagination, sorting. NgRx Signal Store (`UsersStore`) |
| Feature (example) | Done | Description, config, entities list, file upload |
| Theming (light/dark) | Done | System preference detection, Material themes |
| Header & navigation | Done | User menu, theme toggle, auth-aware |
| Shared components | Done | Confirm dialog |
| Error handling | Done | Error interceptor with snackbar notifications |
| 404 / 403 pages | Done | Wildcard route + forbidden page |

### Code Quality Tooling

| Tool | Status | Notes |
|------|--------|-------|
| ESLint (client) | Configured | angular-eslint, unused-imports, import cycles |
| ESLint (server) | Configured | @typescript-eslint + prettier |
| Prettier | Configured | Single quotes, no trailing commas |
| Stylelint | Configured | SCSS recess property order |
| Husky + lint-staged | Configured | Pre-commit hook runs ESLint + Stylelint on staged files |

### Testing

| Type | Status | Notes |
|------|--------|-------|
| Server unit tests (Jest) | Configured | `*.spec.ts` alongside source |
| Client unit tests (Vitest) | Configured | Auth module covered (120 tests / 27 files); migrated to NgRx Signal Store mocks |
| Client E2E (Playwright) | In Progress | Login, register, profile, session-restore tests done (37 tests); users and feature pages not yet covered |
| Server E2E (Jest) | Configured | Separate Jest config |

---

## Recent Activity (Last 7 Days)

| Date | Focus Area | Key Changes |
|------|-----------|-------------|
| 2026-02-11 | State management, Bug fix | NgRx Signal Store integration — AuthStore (global) + UsersStore (route-level); deleted TokenService + AuthService. Fixed session restoration bug (NG0200 circular dependency on init). Added session-restore E2E tests |
| 2026-02-10 | Testing, Code quality | Auth module unit tests (132 tests); Playwright E2E setup; husky + lint-staged pre-commit hooks |
| 2026-02-09 | Unit testing, Auth | Karma → Vitest migration; auth module refactoring |
| 2026-02-08 | Code quality | Stylelint setup, Prettier formatting, linter fixes, auth/storage refactoring |
| 2026-02-07 | Linting | ESLint setup for client + server, auth refactoring |
| 2026-02-06 | Dependencies | Updated Angular and NestJS libraries |

---

## What's Implemented

### Authentication Flow
- Email/password registration and login
- JWT access tokens (1h TTL) + opaque refresh tokens (7d TTL)
- Automatic token refresh 60 seconds before expiry
- 401 error handling with request retry in JWT interceptor
- Concurrent refresh prevention via `shareReplay(1)`
- Server-side token cleanup cron (daily expired, weekly revoked)
- Role-based access control (admin/user)

### User Management
- Admin-only user list with pagination (5/10/25/50) and column sorting
- User detail view with role/status chips
- User edit with admin controls (isAdmin, isActive toggles)
- User search by email, name, admin status, active status
- Delete with confirmation dialog

### UI/UX
- Angular Material component library
- Light/dark theme with system preference + manual toggle
- Responsive SCSS architecture with utilities
- Snackbar error notifications
- Loading spinners
- Form validation with error messages

### Example Feature Module
- Demonstrates NestJS patterns: guards, interceptors, middlewares, pipes, decorators
- CRUD operations for feature entities
- File upload with Multer
- Seeder for sample data

---

## Known Gaps / TODO

### Testing
- E2E tests cover login, register, and profile pages — remaining pages (users, feature) need coverage
- Auth module has comprehensive unit tests; other client modules (users, feature, core) need coverage
- Server unit test coverage needs assessment

### Features Not Yet Implemented
- WebSocket support (proxy configured but no implementation)
- Real-time notifications
- Password reset / forgot password flow
- Email verification
- Pagination on server side (currently returns all results)
- Client environment configuration (environment files exist but are empty)

### Technical Debt
- Server TypeScript strict mode is disabled (`strictNullChecks: false`, `noImplicitAny: false`)
- No CI/CD pipeline configured
- No Docker configuration
- No production deployment configuration
- CORS is fully permissive in `local` environment

---

## Tech Stack Versions

| Technology | Version |
|------------|---------|
| Angular | 21.1.3 |
| NestJS | 11.1.13 |
| TypeScript | 5.9.x |
| TypeORM | 0.3.28 |
| @ngrx/signals | 21.0.x |
| RxJS | 7.8.x |
| Vitest | 4.0.18 |
| Playwright | 1.58.2 |
| Node.js | (see .nvmrc or engines) |
