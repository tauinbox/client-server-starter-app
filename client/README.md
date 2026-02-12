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

## Architecture

### Component Structure

All components are standalone (no NgModules) with `OnPush` change detection and lazy-loaded routes.

```
src/app/
├── core/                   # Header, theme toggle, storage service, 404 page
├── features/
│   ├── auth/               # Login, register, profile, forbidden
│   │   ├── guards/         # authGuard, adminGuard
│   │   ├── interceptors/   # jwtInterceptor, errorInterceptor
│   │   ├── services/       # AuthService (HTTP, refresh scheduling)
│   │   └── store/          # AuthStore (NgRx Signal Store, pure state)
│   ├── users/              # User list, detail, edit, search (admin)
│   │   └── store/          # UsersStore (NgRx Signal Store, route-level)
│   └── feature/            # Example feature module
└── shared/                 # Confirm dialog, shared utilities
```

### Routes

| Path | Component | Guard |
|------|-----------|-------|
| `/login` | LoginComponent | - |
| `/register` | RegisterComponent | - |
| `/profile` | ProfileComponent | authGuard |
| `/users` | UserListComponent | adminGuard |
| `/users/search` | UserSearchComponent | adminGuard |
| `/users/:id` | UserDetailComponent | authGuard |
| `/users/:id/edit` | UserEditComponent | authGuard |
| `/feature` | FeatureComponent | - |
| `/forbidden` | ForbiddenComponent | - |
| `/**` | PageNotFoundComponent | - |

### State Management

NgRx Signal Store (`@ngrx/signals`):

- **AuthStore** (`providedIn: 'root'`) — pure state container managing `localStorage('auth_storage')`, exposes `user`, `isAuthenticated`, `isAdmin` computed signals. No `HttpClient` dependency
- **AuthService** (`providedIn: 'root'`) — HTTP operations (login/register/logout/refresh/profile), token refresh scheduling via `provideAppInitializer`. Eliminates the circular dependency chain
- **UsersStore** (route-level at `/users`) — entity-based store with `withEntities<User>()`. Manages user list, detail, search state with pagination and loading indicators
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
- API mocking via route interception (no real backend needed)
- Modular fixture architecture in `e2e/fixtures/`:
  - `base.fixture.ts` — custom `mockApi` fixture (blocks real API calls) + re-exports all modules
  - `jwt.utils.ts` — JWT creation utilities
  - `mock-data.ts` — shared test data (users, tokens)
  - `mocks/auth.mocks.ts` — auth route mocks
  - `mocks/users.mocks.ts` — users route mocks
  - `helpers.ts` — `loginViaUi()`, `expectAuthRedirect()`, `expectForbiddenRedirect()`
- Test structure: organized by module in `e2e/auth/` and `e2e/users/`
- Coverage: 95 tests (37 auth + 58 users) covering login, register, profile, session-restore, users list/detail/edit/search

```bash
npm run test:e2e           # Headless
npm run test:e2e:ui        # Interactive UI
```

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
