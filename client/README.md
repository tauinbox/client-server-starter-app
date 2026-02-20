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
├── core/                   # Header, theme toggle, storage/session-storage services, error interceptor, 404 page
├── features/
│   ├── auth/               # Login, register, profile, OAuth callback, verify-email, forgot-password, reset-password, forbidden
│   │   ├── guards/         # authGuard, adminGuard
│   │   ├── interceptors/   # jwtInterceptor
│   │   ├── services/       # AuthService (HTTP, refresh scheduling)
│   │   └── store/          # AuthStore (NgRx Signal Store, pure state)
│   ├── users/              # User list, detail, edit, search (admin)
│   │   ├── components/
│   │   │   └── user-table/ # UserTableComponent (shared table for user-list and user-search)
│   │   └── store/          # UsersStore (NgRx Signal Store, route-level)
│   └── feature/            # Example feature module
└── shared/
    ├── components/
    │   ├── confirm-dialog/ # Confirmation dialog
    │   └── password-toggle/# PasswordToggleComponent (reusable password visibility toggle)
    ├── models/             # user.types
    └── utils/              # css.utils
```

### Routes

| Path | Component | Guard |
|------|-----------|-------|
| `/login` | LoginComponent | guestGuard |
| `/register` | RegisterComponent | guestGuard |
| `/profile` | ProfileComponent | authGuard |
| `/users` | UserListComponent | adminGuard |
| `/users/search` | UserSearchComponent | adminGuard |
| `/users/:id` | UserDetailComponent | authGuard |
| `/users/:id/edit` | UserEditComponent | authGuard |
| `/verify-email` | VerifyEmailComponent | - |
| `/forgot-password` | ForgotPasswordComponent | guestGuard |
| `/reset-password` | ResetPasswordComponent | guestGuard |
| `/oauth/callback` | OAuthCallbackComponent | - |
| `/feature` | FeatureComponent | - |
| `/forbidden` | ForbiddenComponent | - |
| `/**` | PageNotFoundComponent | - |

### State Management

NgRx Signal Store (`@ngrx/signals`):

- **AuthStore** (`providedIn: 'root'`) — pure state container managing `localStorage('auth_storage')`, exposes `user`, `isAuthenticated`, `isAdmin` computed signals. No `HttpClient` dependency
- **AuthService** (`providedIn: 'root'`) — HTTP operations (login/register/logout/refresh/profile/OAuth accounts), token refresh scheduling via `provideAppInitializer`. Eliminates the circular dependency chain
- **UsersStore** (route-level at `/users`) — entity-based store with `withEntities<User>()`. Manages user list, detail, search state with **server-side pagination** (calls API with page/limit/sort params, stores totalItems/totalPages from server response) and loading indicators
- **ThemeService** — `theme` signal (`'light'` | `'dark'`), system preference detection, persists to localStorage

### HTTP Interceptors

1. **errorInterceptor** — catches errors, shows `MatSnackBar` notifications, skips 401s
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
├── components/       # Cards, forms, loading, tables
└── utilities/        # Flex, spacing, text, visibility helpers
```

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
- Seed data: 5 well-known users + 65 faker-generated (70 total). Credentials: `admin@example.com / Password1` (admin), `user@example.com / Password1` (user)
- Modular fixture architecture in `e2e/fixtures/`:
  - `base.fixture.ts` — `_mockServer` (MockServerApi) and `_workerMockServer` fixtures + re-exports all modules
  - `jwt.utils.ts` — JWT creation utilities (`base64url`, `createMockJwt`, `createExpiredJwt`, `createValidJwt`)
  - `mock-data.ts` — `MockUser` type, `defaultUser`, factory re-exports (`createMockUser`, `createOAuthAccount`)
  - `helpers.ts` — `loginViaUi()`, `expectAuthRedirect()`, `expectForbiddenRedirect()`
- Test structure: organized by module in `e2e/auth/` and `e2e/users/`
- Coverage: 113 tests (55 auth + 58 users) covering login, register, profile, session-restore, lockout, email verification, password reset (with password confirmation), users list/detail/edit/search. User list and search tests updated to work with server-side paginated responses from mock-server
- Workers: 4 (fully parallel, per-worker mock-server instances on dynamic ports)

```bash
npm run test:e2e           # Headless
npm run test:e2e:ui        # Interactive UI
```

## Versioning

The version string is generated at build/start/test time by `scripts/version.mjs`:

1. Reads `version` from `client/package.json`
2. Gets the current git short hash via `git rev-parse --short HEAD`
3. Writes `src/environments/version.ts` (gitignored):

```typescript
export const APP_VERSION = '0.1.0';
export const BUILD_HASH = 'abc1234';
```

`HeaderComponent` imports these values and displays them as a `MatTooltip` on the "Pet project" toolbar span.

To cut a new release (from `client/`):

```bash
npm run release    # bumps client + server + mock-server package.json, writes repo CHANGELOG.md, tags commit
git push --follow-tags
```

Commits must follow [Conventional Commits](https://www.conventionalcommits.org/) — enforced by the `commit-msg` husky hook.

## Tech Stack

| Technology | Version |
|------------|---------|
| Angular | 21.1.3 |
| Angular Material | 21.1.3 |
| TypeScript | 5.9.x |
| @ngrx/signals | 21.0.x |
| RxJS | 7.8.x |
| Vitest | 4.0.18 |
| Playwright | 1.58.2 |
| ESLint | 9.x |
| Prettier | 3.x |
| Stylelint | 17.x |
| commitlint | 20.x |
| commit-and-tag-version | 12.x |
