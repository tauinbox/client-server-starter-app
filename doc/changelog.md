# Changelog

All notable changes to this project, organized by date and grouped by theme.

---

## 2026-02-11

### Architecture
- **extract AuthService from AuthStore** - Split `AuthStore` into a pure state container (no `HttpClient`) and a new `AuthService` (`@Injectable`) that owns all HTTP operations, token refresh scheduling, and session lifecycle. Eliminates the circular dependency chain (`AuthStore → HttpClient → jwtInterceptor → AuthStore`) at its root. Removed the `setTimeout` workaround in store init. Added `provideAppInitializer` in `app.config.ts` to call `AuthService.initSession()`. Updated JWT interceptor to inject `AuthStore` directly for token reads and lazy-inject `AuthService` for refresh/logout. Updated `ensureAuthenticated` utility, both guards, and all auth-related components. Created `auth.service.spec.ts` (12 tests) and updated all existing spec files (134 unit tests pass, 37 e2e tests pass).

### State Management
- **integrate NgRx Signal Store** - Replaced `TokenService` + `AuthService` with a single `AuthStore` (`@ngrx/signals`, `providedIn: 'root'`). Created route-level `UsersStore` with `withEntities<User>()` for user list/detail/search/edit state. Migrated all guards, interceptors, and components to use the new stores. Deleted `TokenService` and `AuthService`. Updated all unit tests.

### Bug Fixes
- **fix session restoration with expired access token** - Fixed circular dependency (NG0200) during `AuthStore` initialization: `onInit` → `scheduleTokenRefresh` → `http.post()` → `jwtInterceptor` → `inject(AuthStore)` while the store was still being constructed. Deferred `scheduleTokenRefresh` in `initFromStorage` with `setTimeout` so the store is fully registered before making HTTP requests. The auth guard handles immediate refresh for expired tokens during route navigation. Added `withState` factory to read auth data from localStorage at construction time (no race condition). Added storage fallback in `refreshTokens()` for edge cases.

### E2E Testing
- **add session restoration e2e tests** - Added `session-restore.spec.ts` with 3 Playwright tests covering: expired access token + valid refresh token → session restored, expired + invalid refresh → redirect to login, session restoration from root URL redirect.

## 2026-02-10

### Unit Testing
- **comprehensive auth module unit tests** - Added 132 unit tests across 16 spec files covering the entire `client/src/app/features/auth/` module: utility functions (should-attempt-token-refresh, add-token-to-request, is-auth-excluded-urls, is-token-refresh-excluded-urls, navigate-to-login, ensure-authenticated), services (TokenService, AuthService with timer scheduling), interceptors (errorInterceptor, jwtInterceptor with refresh retry), guards (authGuard, adminGuard), and deepened component tests (LoginComponent, RegisterComponent, ProfileComponent) with form validation, submit behavior, error handling, and navigation.

### Code Quality
- **setup husky and lint-staged for pre-commit linting** - Husky and lint-staged installed in `client/` sub-package (no root `node_modules`). Pre-commit hook (`client/.husky/pre-commit`) runs ESLint (client + server) and Stylelint (client SCSS) with auto-fix on staged files. Config in `.lintstagedrc.mjs` resolves each sub-project's linter binary and config path.

### E2E Testing
- **install and configure playwright e2e** (`9d853f6`) - Set up Playwright with Chromium for end-to-end testing. Custom fixtures with API mocking (`mockLogin`, `mockProfile`, `mockRefreshToken`). Login page test suite covering form display, validation, successful login, and error handling.
- **add register page e2e tests** (`d52fe5c`) - Added `mockRegister` and `mockRegisterError` helpers to base fixture. 12 tests covering: form display, submit button state (empty/invalid email/short password/valid), validation errors (required fields, email format, password min length), successful registration with redirect to login, duplicate email error (409), generic server error (500), and login page link navigation.
- **add profile page e2e tests** - Added `mockUpdateUser` and `loginViaUi` helpers to base fixture. 18 tests covering: auth guard redirect, account info display (with admin/inactive variants), form pre-population, submit button state management, successful profile update with UI refresh, update failure error, and field validation errors.

## 2026-02-09

### Testing Infrastructure
- **migrate from karma to vitest** (`e58ae71`) - Replaced Karma + Jasmine with Vitest using `@angular/build:unit-test` builder. Added jsdom environment, `matchMedia` polyfill setup file, and `esnext.disposable` lib for vitest/globals types.

### Auth Refactoring
- **refactor auth module** (`fefe6a5`, `35d81f3`, `a946700`) - Continued cleanup and restructuring of the authentication module on both client and server.

## 2026-02-08

### Auth & Services Refactoring
- **refactor auth module** (`4dd11a0`) - Further auth module improvements.
- **refactor storage service** (`c41cd65`) - Improved StorageService implementation.
- **auth refactoring** (`fdad1e2`, `d0ff903`) - Restructured auth services and interceptors.

### Code Quality
- **linter fixes** (`7877a60`, `b466dc7`) - Applied ESLint auto-fixes across the codebase.
- **refactor auth module a bit more** (`c3cb089`) - Minor auth cleanups.
- **configure and apply stylelint** (`0871900`) - Added Stylelint for SCSS with recess property order.
- **apply prettier fixes** (`2864918`) - Applied Prettier formatting.
- **minor changes** (`5b4c2f0`) - Small adjustments.

### Auth Refactoring
- **refactor auth module** (`a30a59c`) - Auth module restructuring.

## 2026-02-07

### Code Quality & Linting
- **apply eslint for the server side** (`1b85580`) - Applied ESLint rules to server code.
- **eslint for the server side** (`2dcf449`, `3b2ec95`) - Configured ESLint with `@typescript-eslint` + prettier plugin for server.
- **configure ignore files** (`a25cf9f`) - Set up `.eslintignore`, `.prettierignore` and similar.
- **apply eslint** (`5692df4`) - Applied ESLint rules to client code.
- **configure eslint** (`a811ebe`) - Configured ESLint with `angular-eslint` for client.

### Auth & Bug Fixes
- **auth module refactoring** (`558e6bd`) - Restructured auth module organization.
- **fix updating header on user update** (`e50bf5b`) - Fixed header component not reflecting user profile changes.
- **auth refactoring** (`38ce0fd`) - Auth flow improvements.

## 2026-02-06

### Dependency Updates
- **update server libs** (`82f6d4e`) - Updated NestJS and server dependencies.
- **update client libs** (`ae5bc02`) - Updated Angular and client dependencies.
- **refactored a bit** (`5535658`) - Minor code improvements.

## 2025-12-16

- **refactored a bit** (`7b5d817`) - Minor refactoring.

## 2025-12-13

- **refactor** (`a97741e`) - Code improvements.

## 2025-12-04

### Dependency Updates
- **update framework libraries** (`d31b3c7`) - Updated Angular and NestJS to newer versions.

## 2025-09-23

### Maintenance
- **refactor theme service** (`8fe65ef`) - Improved ThemeService implementation.
- **update client version** (`9dc0545`) - Updated Angular version.
- **update server version** (`8d0e8ec`) - Updated NestJS version.

## 2025-03-25

### Bug Fixes
- **fix jwt interceptor token refresh issue** (`9fb8a0b`) - Fixed race condition in JWT interceptor during concurrent token refresh attempts.

## 2025-03-22 - 2025-03-23

### Refresh Token Feature
- **implement refresh token functionality** (`b8f130b`) - Added refresh token support with automatic scheduling and 401 error handling.
- **refactored refresh token functionality** (`b4b69e8`, `3697f78`) - Improved refresh token logic with `shareReplay(1)` to prevent duplicate requests.
- **refactor a bit** (`46f2416`, `4e389c2`, `36e4973`, `9294127`) - Minor code cleanups.

### Styling
- **adjust styling** (`2a46ae5`, `7205f8e`) - UI adjustments.
- **adjust colors** (`c7173a8`, `3e6d1a5`) - Theme color tuning.
- **adjust spacings** (`ed33daa`, `d264018`) - Layout spacing fixes.

## 2025-03-21

### Styling Overhaul
- **adjust styling** (`2672f95`, `73ca798`, `ddcf6ec`, `4a3865c`, `d407f06`) - Major styling improvements.
- **add base styles** (`7ab8aed`) - Established base SCSS architecture.
- **styles cleanup** (`d6611f2`) - Removed unused styles.
- **use rems instead of pixels** (`712cd20`) - Migrated to rem-based spacing.
- **refactor styling** (`db682ad`) - Restructured SCSS organization.
- **minor fix** (`120d9b8`) - Small bug fix.

## 2025-03-15

### User Search & Code Quality
- **adjust user search form** (`6383f79`) - Improved search form layout.
- **fix autocomplete issues** (`696dba4`) - Fixed Material autocomplete behavior.
- **fix search layout** (`d756c6e`) - Layout fixes for search results.
- **reformat client with prettier** (`f796bde`) - Applied Prettier to all client files.
- **reformat server with prettier** (`a47dc86`) - Applied Prettier to all server files.
- **add prettier for the client** (`b0d63bc`) - Configured Prettier for the client.

## 2025-03-06

### Styling
- **adjust styles** (`f0e1c00`, `71ffeef`) - UI styling adjustments.

## 2025-03-01 - 2025-03-04

### Dark Theme & UI Architecture
- **implement dark theme support** (`26e7d6e`) - Added light/dark theme with system preference detection, CSS custom properties, Material theme integration.
- **apply mat-theme changes** (`797a015`) - Applied Angular Material theme configuration.
- **rearrange styles** (`6a7b7e7`) - Reorganized SCSS file structure.
- **clean up** (`b93f099`) - Code cleanup.
- **bind routes to component input** (`d403cec`) - Enabled `withComponentInputBinding()` for route params.
- **rearrange types** (`fe7455a`) - Reorganized TypeScript types.
- **implement base auth and user management components** (`dcf2ed8`) - Built core Angular UI: login, register, profile, user list/detail/edit/search, guards, interceptors.
- **config** (`1447cde`) - Application configuration setup.
- **void for unused promise response** (`cf3977e`) - Code quality fix.

## 2025-02-28

### Angular Material
- **update angular, add material** (`d74f1ba`) - Added Angular Material and CDK to the client.

## 2025-02-27

### Server Features
- **implement users and auth modules** (`7b03adb`) - Built complete auth system: JWT + refresh tokens, Passport strategies, bcrypt password hashing, user CRUD, role-based access.
- **set up cors** (`592a486`) - Configured CORS with environment-based origin validation.
- **add types for compression and cookie parser** (`08ab52a`) - Added TypeScript types.
- **add compression and cookie parser** (`cc16e7e`) - Added gzip compression and cookie parsing middleware.
- **set contact info** (`78d7725`) - Added project contact information.
- **Adjust postgres config** (`67ea3ca`) - PostgreSQL configuration tweaks.

## 2025-02-26

### File Upload
- **implement file upload** (`69c35b3`) - Added file upload endpoint with Multer, disk storage, and unique filenames.

## 2025-02-22 - 2025-02-25

### Feature Module (Example)
- **implement CRUD** (`758fd48`) - Full CRUD operations for feature entities.
- **add custom pipe and middleware** (`57441c4`) - NameValidatorPipe and FeatureLoggingMiddleware.
- **add more examples and descriptions** (`fd1c9f3`) - Extended example code.
- **rename folders, implement example guard** (`deb1d05`) - FeatureControllerGuard and folder restructuring.
- **add more guard examples** (`784cff2`) - FeatureMethodGuard with cookie setting.
- **add using metadata examples** (`45cd926`) - @FeatureRoles decorator and metadata keys.
- **add interceptor examples** (`168e3dd`) - FeatureInterceptor with timing and data filtering.
- **remove unused interface** (`736954f`) - Cleanup.
- **update entity dto** (`53872c8`) - DTO improvements.
- **refactor entity creation** (`e6b80d8`) - Improved entity construction.
- **refactor repository operations** (`08c28a6`) - Improved TypeORM operations.
- **add application type** (`8a728b3`) - Added application type definitions.

## 2025-02-03

### Framework Upgrade & Modernization
- **upgrade client and server to the latest frameworks** (`84203e5`) - Major version upgrade of Angular and NestJS with all dependencies.
- **update to a new control flow syntax** (`c0dbb17`) - Migrated templates to `@if`, `@for`, `@switch` syntax.
- **refactor with new rxResource** (`85eb4ce`) - Adopted `rxResource` for reactive data loading.
- **refactor description and config endpoints** (`dbee420`) - Improved feature module endpoints.

## 2024-10-30

### Documentation & Fixes
- **add swagger connection info** (`0dc76f6`) - Added Swagger API documentation at `/swagger`.
- **fix migration datasource path** (`5790a5f`) - Fixed TypeORM migration data source.
- **update versions** (`c3df56a`) - Dependency version updates.

## 2024-01-28

- **update versions** (`d5808be`) - Dependency updates.

## 2023-11-26

### Feature Module Foundation
- **update angular version** (`324709a`) - Angular version update.
- **feature implementation** (`eccba9b`) - Initial feature module with controller and service.

## 2023-11-02 - 2023-11-04

### Project Bootstrap
- **set up DB and ORM** (`d38d438`, `fb53492`) - PostgreSQL + TypeORM configuration, migrations setup.
- **change primary key type** (`2a3ae8d`) - Switched to appropriate PK types.
- **change module name** (`bccbc35`) - Module naming.
- **server controller with starter API** (`c80ef84`) - Initial NestJS controller.
- **initial commit** (`badc9f4`) - Project scaffolding with NestJS and Angular.
