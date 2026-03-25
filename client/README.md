# Client

Angular 21 SPA with standalone components, Angular Material UI, JWT authentication, and light/dark theming.

## Getting Started

```bash
npm install
npm start             # Dev server at http://localhost:4200 (proxies /api to backend)
```

The dev proxy (`proxy.conf.mjs`) forwards `/api` and `/ws` requests to `BACKEND_URL` (default `http://localhost:3000`).

## Commands

| Task | Command |
|------|---------|
| Dev server | `npm start` |
| Build | `npm run build` |
| Lint | `npm run lint` |
| Unit tests | `npm test` (Vitest) |
| E2E tests | `npm run test:e2e` (Playwright) |
| E2E tests (UI) | `npm run test:e2e:ui` |
| Release | `npm run release` (bump versions, generate CHANGELOG.md, create git tag) |

## Architecture

### Component Structure

All components are standalone (no NgModules) with `OnPush` change detection and lazy-loaded routes.

```
src/app/
├── core/                   # Header, sidenav, theme toggle, storage/session-storage services, error interceptor, 404 page, NotificationsService (SSE)
├── features/
│   ├── auth/               # Login, register, profile, OAuth callback, verify-email, forgot-password, reset-password, forbidden
│   │   ├── casl/           # app-ability.ts — AppAbility, Actions, Subjects, PermissionCheck types
│   │   ├── directives/     # RequirePermissionsDirective (*appRequirePermissions="{ action, subject } | [...]")
│   │   ├── guards/         # authGuard, guestGuard, permissionGuard(action, subject)
│   │   ├── interceptors/   # jwtInterceptor
│   │   ├── services/       # AuthService (HTTP, refresh scheduling, fetchPermissions: Promise<void>), rbac-metadata.service.ts
│   │   └── store/          # AuthStore (NgRx Signal Store — state: accessToken (memory) + user (auth_user localStorage) + ability: AppAbility|null), RbacMetadataStore
│   ├── users/              # User list (with inline filters), detail, edit (admin)
│   │   ├── components/
│   │   │   └── user-table/ # UserTableComponent (shared table; sorting + actions only, no paginator)
│   │   └── store/          # UsersStore (NgRx Signal Store, route-level)
│   └── admin/              # Admin panel (roles + resource + user management)
│       ├── admin.routes.ts # Lazy-loaded child routes under /admin
│       ├── components/
│       │   ├── admin-panel/             # AdminPanelComponent — tabbed shell (Users / Roles / Resources)
│       │   ├── roles/
│       │   │   ├── role-list/           # RoleListComponent — data table with create/edit/delete actions
│       │   │   ├── role-form-dialog/    # RoleFormDialogComponent — create and edit role (name, description)
│       │   │   └── role-permissions-dialog/ # RolePermissionsDialogComponent — permission matrix with CASL condition editors
│       │   └── resources/
│       │       ├── resource-list/       # ResourceListComponent — two-section page (Resources + Actions tables)
│       │       ├── resource-form-dialog/ # ResourceFormDialogComponent — edit resource displayName/description
│       │       └── action-form-dialog/  # ActionFormDialogComponent — create/edit action with name pattern validation
│       ├── services/       # RoleService (HTTP → /api/v1/roles), RbacAdminService (HTTP → /api/v1/rbac/*)
│       └── store/          # RolesStore (route-level), ResourcesStore (route-level: resources, actions, loading)
└── shared/
    ├── components/
    │   ├── confirm-dialog/ # Confirmation dialog
    │   └── password-toggle/# PasswordToggleComponent (reusable password visibility toggle)
    ├── models/             # user.types
    └── utils/              # css.utils, dialog.utils (DialogSize enum + dialogSizeConfig())
```

### Routes

| Path | Component | Guard |
|------|-----------|-------|
| `/login` | LoginComponent | guestGuard |
| `/register` | RegisterComponent | guestGuard |
| `/profile` | ProfileComponent | authGuard |
| `/users` | UserListComponent | permissionGuard('search', 'User') |
| `/users/:id` | UserDetailComponent | authGuard |
| `/users/:id/edit` | UserEditComponent | authGuard |
| `/admin` | AdminPanelComponent | adminPanelGuard (search/User OR read/Role OR read/Permission) |
| `/admin/users` | UserListComponent | (inherited from /admin) |
| `/admin/roles` | RoleListComponent | permissionGuard('read', 'Role') |
| `/admin/resources` | ResourceListComponent | permissionGuard('read', 'Permission') |
| `/verify-email` | VerifyEmailComponent | - |
| `/forgot-password` | ForgotPasswordComponent | guestGuard |
| `/reset-password` | ResetPasswordComponent | guestGuard |
| `/oauth/callback` | OAuthCallbackComponent | - |
| `/forbidden` | ForbiddenComponent | - |
| `/**` | PageNotFoundComponent | - |

### State Management

NgRx Signal Store (`@ngrx/signals`):

- **AuthStore** (`providedIn: 'root'`) — pure state container. State: `accessToken` (in-memory signal only, never persisted), `user` (persisted to `localStorage` as `auth_user` key for page-reload detection), `ability: AppAbility | null`. Computed: `isAuthenticated` (access token present), `user`, `roles`, `isAdmin`. Methods: `hasPermissions(action, subject)`, `setRules(rules)`, `hasPersistedUser()`, `saveAuthResponse()`, `clearSession()`. No `HttpClient` dependency
- **AuthService** (`providedIn: 'root'`) — HTTP operations (login/register/logout/refresh/profile/OAuth accounts/`fetchPermissions(): Promise<void>`/`fetchRbacMetadata(): Promise<void>`). `login()` uses `switchMap` to await `fetchPermissions()` before emitting — ensures permissions are loaded before route guards evaluate. `refreshTokens()` POSTs `{}` — the `refresh_token` HttpOnly cookie is sent automatically by the browser. `provideAppInitializer` awaits `Promise.all([fetchPermissions(), fetchRbacMetadata()])` for authenticated users, or attempts a cookie-refresh first when `hasPersistedUser()` is true (page reload with no in-memory token). `fetchRbacMetadata()` implements stale-while-revalidate: returns immediately if data is cached in `RbacMetadataStore`, refreshes in background
- **UsersStore** (route-level at `/users`) — entity-based store with `withEntities<User>()`. Unified state: `filters: UserSearch` (empty = all users, filled = search via `GET /users/search`), single `load()`/`loadMore()` pair with **infinite scroll** (page size 20; `upsertEntities` appends; `hasMore` computed signal drives sentinel visibility; `isLoadingMore` shows spinner). `setFilters()` and `setSorting()` update state; component calls `load()` after each change
- **RbacMetadataStore** (`providedIn: 'root'`) — NgRx Signal Store with stale-while-revalidate localStorage caching for resources/actions metadata. Loaded at bootstrap via `AuthService.fetchRbacMetadata()` (only when authenticated). Computed: `subjectMap` (resource name to CASL subject)
- **ThemeService** — `theme` signal (`'light'` | `'dark'`), system preference detection, persists to localStorage
- **NotificationsService** (`providedIn: 'root'`) — SSE client using `HttpClient` with `observe: 'events'` so the JWT interceptor attaches `Authorization: Bearer` automatically. Parses `HttpDownloadProgressEvent.partialText` with offset tracking. Exposes: `sessionInvalidated$` (calls `tokenService.forceLogout()`), `permissionsUpdated$` (triggers `authService.fetchPermissions()`), `userCrudEvents$` (drives user list refresh). `connect()` called after login and session restore; `disconnect()` called on logout. Reconnects with 5-attempt exponential backoff; stops reconnecting when not authenticated

### HTTP Interceptors

1. **errorInterceptor** — catches errors, shows `MatSnackBar` notifications, skips 401s. On first 403: silently re-fetches `GET /auth/permissions`, calls `AuthStore.setRules()` (which triggers `RequirePermissionsDirective` via `effect()`), then retries the original request once. `RBAC_RETRY_CONTEXT` token prevents retry loops. Permissions-fetch failure and retry failure are handled separately with distinct snackbar messages.
2. **jwtInterceptor** — attaches `Authorization: Bearer` header, handles 401 with token refresh + request retry, uses `shareReplay(1)` to prevent concurrent refreshes

### Path Aliases

| Alias | Path |
|-------|------|
| `@core/*` | `src/app/core/*` |
| `@features/*` | `src/app/features/*` |
| `@shared/*` | `src/app/shared/*` |
| `@environments/*` | `src/environments/*` |
| `@app/shared/*` | `../shared/src/*` (shared types/constants across all 3 workspaces) |

## Styling

- **Angular Material** + Angular CDK for UI components
- **SCSS architecture** with themes, utilities, and component styles
- **Light/dark theming** via CSS custom properties and Material theme mixins
- **Stylelint** with recess property order

```
src/styles/
├── abstracts/        # Variables, functions, mixins
├── base/             # Reset, typography, animations
├── themes/           # Light and dark Material themes + CSS vars
├── layout/           # Containers, grids
├── components/       # Cards, forms, loading, tables, dialogs (_dialogs.scss — global dialog overrides)
└── utilities/        # Flex, spacing, text, visibility helpers
```

All size values use `func.rem(N)` (pixels → rem conversion) — never hardcoded `px`/`rem` literals. Global dialog styles live in `_dialogs.scss` (title padding, `::before` reset, bug #26352 fix). Dialog sizes are managed via `DialogSize` enum + `dialogSizeConfig()` in `shared/utils/dialog.utils.ts`.

## Testing

### Unit Tests (Vitest)

- Builder: `@angular/build:unit-test`
- Environment: jsdom
- Setup file: `src/test-setup.ts` (matchMedia polyfill)
- Pattern: `*.spec.ts` alongside source files

```bash
npm test
```

### E2E Tests (Playwright)

- Browser: Chromium
- **API testing**: Uses in-memory Express mock-server with per-worker isolation (not route interception)
- Worker-scoped fixture starts Express on dynamic port (`app.listen(0)`), test-scoped resets state
- `page.route(/\/api\//)` intercepts API calls and rewrites URL to worker's mock-server port
- **CI web server**: runs `ng build` before `playwright test`, then serves the pre-built output via `serve -s dist/client/browser` (eliminates 60-90 s Angular dev-server startup). Local dev still uses `ng serve`
- Seed data: 5 well-known users + 65 faker-generated (70 total). Credentials: `admin@example.com / Password1` (admin), `user@example.com / Password1` (user)
- Modular fixture architecture in `e2e/fixtures/`:
  - `base.fixture.ts` — `_mockServer` (MockServerApi) and `_workerMockServer` fixtures + re-exports all modules
  - `jwt.utils.ts` — JWT creation utilities (`base64url`, `createMockJwt`, `createExpiredJwt`, `createValidJwt`)
  - `mock-data.ts` — `MockUser` type, `defaultUser`, factory re-exports (`createMockUser`, `createOAuthAccount`)
  - `helpers.ts` — `loginViaUi()`, `expectAuthRedirect()`, `expectForbiddenRedirect()`
- Test structure: organized by module in `e2e/auth/` and `e2e/users/`
- Coverage: 113 tests (55 auth + 58 users) — unit test suite: 368 tests passing covering login, register, profile, session-restore, lockout, email verification, password reset (with password confirmation), users list/detail/edit/search, admin roles/resources management. User list and search tests updated to work with server-side paginated responses from mock-server
- Workers: 4 (fully parallel, per-worker mock-server instances on dynamic ports)

```bash
npm run test:e2e           # Headless
npm run test:e2e:ui        # Interactive UI
```

## Docker

A 2-stage `Dockerfile` is provided for production builds:

1. **builder** — installs deps (`npm ci --ignore-scripts`), builds Angular with `NODE_OPTIONS="--max-old-space-size=2048" npm run build -- --base-href $BASE_HREF` (ARG `BASE_HREF` defaults to `/nexus/`, overridable at `docker build --build-arg BASE_HREF=/`)
2. **runner** — copies built assets to nginx:1.27-alpine with `client/nginx.conf` (gzip enabled, HTML5 pushState support via `try_files`, `Cache-Control: public, max-age=31536000, immutable` for content-hashed bundles, `Cache-Control: no-cache` for `index.html`)

The Angular app is served from `/nexus/` base href. All internal API URLs must use absolute paths starting with `/` (e.g. `/api/v1/users`) so they resolve to the server root, not to `/nexus/api/v1/users`.

Use `docker-compose.yml` at the repo root to run the full stack.

---

## Versioning

The version string is generated at build/start/test time by `scripts/version.mjs`:

1. Reads `version` from `client/package.json`
2. Gets the current git short hash via `git rev-parse --short HEAD`
3. Writes `src/environments/version.ts` (gitignored):

```typescript
export const APP_VERSION = '0.1.0';
export const BUILD_HASH = 'abc1234';
```

`HeaderComponent` imports these values and displays them as a `MatTooltip` on the app name toolbar span (value sourced from `environment.appName`).

To cut a new release (from `client/`):

```bash
npm run release    # bumps client + server + mock-server package.json, writes repo CHANGELOG.md, tags commit
git push --follow-tags
```

Commits must follow [Conventional Commits](https://www.conventionalcommits.org/) — enforced by the `commit-msg` husky hook.

## Tech Stack

| Technology | Version |
|------------|---------|
| Angular | 21.2.5 |
| Angular Material | 21.2.3 |
| TypeScript | 5.9.3 |
| @ngrx/signals | 21.0.1 |
| RxJS | 7.8.2 |
| Vitest | 4.0.18 |
| Playwright | 1.58.2 |
| ESLint | 9.39.2 |
| Prettier | 3.8.1 |
| Stylelint | 17.1.1 |
| commitlint | 20.4.1 |
| commit-and-tag-version | 12.6.1 |
