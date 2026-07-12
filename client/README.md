# Client

Angular 21 SPA with standalone components, Angular Material M3 UI, JWT authentication, and light/dark theming.

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
| Lint (TS + SCSS + checks) | `npm run lint` |
| Lint fix (TS + SCSS) | `npm run lint:fix` |
| Lint SCSS only | `npm run lint:styles` |
| Unit tests | `npm test` (Vitest) |
| E2E tests | `npm run test:e2e` (Playwright) |
| E2E tests (UI) | `npm run test:e2e:ui` |
| Audit dependencies | `npm run audit:ci` (`npm audit --audit-level=high --omit=dev`, same gate CI enforces) |
| Release | `npm run release` (bump versions, generate CHANGELOG.md, create git tag) |

## Architecture

### Component Structure

All components are standalone (no NgModules) with `OnPush` change detection and lazy-loaded routes.

```
src/app/
├── core/                   # Header, sidenav, theme toggle, storage/session-storage services, error interceptor, 404 page, NotificationsService (SSE), LayoutService (CDK Breakpoints → signals: isHandset/isTablet/isWeb)
├── features/
│   ├── auth/               # Login, register, profile, OAuth callback, verify-email, forgot-password, reset-password, forbidden
│   │   ├── casl/           # app-ability.ts — AppAbility, Actions, Subjects (auto-generated KnownSubjects + AnyObject), PermissionCheck (action, subject, instance?)
│   │   ├── directives/     # RequirePermissionsDirective (*appRequirePermissions="check; else fallbackTpl" — optional else template renders a fallback view (e.g. disabled button + tooltip) when access is denied)
│   │   ├── guards/         # authGuard, guestGuard, permissionGuard(action, subject), instancePermissionGuard(action, subject, instanceFactory)
│   │   ├── interceptors/   # jwtInterceptor
│   │   ├── services/       # AuthService (HTTP, refresh scheduling, fetchPermissions: Promise<void>), rbac-metadata.service.ts
│   │   └── store/          # AuthStore (NgRx Signal Store — state: accessToken (memory) + user (auth_user localStorage) + ability: AppAbility|null), RbacMetadataStore
│   ├── feature-flags/      # Client core for the feature-flags subsystem
│   │   ├── services/       # FeatureFlagService — HttpClient.get('/api/v1/feature-flags', { withCredentials: true }); silent-error context so bootstrap failures don't toast
│   │   ├── store/          # FeatureFlagsStore — NgRx Signal Store ({ providedIn: 'root' }) state: { flags: Record<string, boolean>; loaded: boolean }; methods: load() / reload() / clear() / isEnabled(key): Signal<boolean> (per-key memoized computed)
│   │   ├── guards/         # featureFlagGuard(key, redirectTo = '/forbidden') — pipes through ensureAuthenticated() so an expired token gets refreshed before the flag check; redirects to /forbidden on miss
│   │   ├── directives/     # HasFeatureDirective — *nxsHasFeature="'flag-key'"; effect()-based; optional nxsHasFeatureElse input for a TemplateRef fallback (zero-config "coming soon" placeholder)
│   │   └── pipes/          # FeatureEnabledPipe — {{ 'flag-key' | featureEnabled }} for attribute bindings; pure: false because the value is sourced from the store signal (single property lookup, trivial per-CD cost)
│   ├── users/              # User list (with inline filters), detail, edit, effective-permissions (admin)
│   │   ├── components/
│   │   │   ├── user-table/        # UserTableComponent (shared table; sorting + actions only, no paginator) — shown on tablet/desktop
│   │   │   ├── user-card-list/    # UserCardListComponent — mat-card grid with per-user action menu; shown on handset (via LayoutService.isHandset())
│   │   │   └── user-permissions/  # UserPermissionsComponent — read-only effective-permissions preview grouped by resource (mat-accordion + deny indicators)
│   │   └── store/          # UsersStore (NgRx Signal Store, route-level)
│   ├── admin/              # Admin panel (roles + resource + user management)
│       ├── admin.routes.ts # Lazy-loaded child routes under /admin
│       ├── components/
│       │   ├── admin-panel/             # AdminPanelComponent — tabbed shell (Users / Roles / Resources); auto-redirects to /forbidden when admin permissions are revoked mid-session via `effect()` calling the shared `canAccessAdminPanel` helper (also used by adminPanelGuard and the admin entry in SidenavStateService.navLinks); the redirect effect is gated on `isAuthenticated()` so logout does not flash through /forbidden
│       │   ├── roles/
│       │   │   ├── role-list/           # RoleListComponent — data table with create/edit/delete actions
│       │   │   ├── role-form-dialog/    # RoleFormDialogComponent — create and edit role (name, description)
│       │   │   └── role-permissions-dialog/ # RolePermissionsDialogComponent — permission matrix with CASL condition editors and per-permission Allow/Deny toggle (effect)
│       │   └── resources/
│       │       ├── resource-list/       # ResourceListComponent — two-section page (Resources + Actions tables)
│       │       ├── resource-form-dialog/ # ResourceFormDialogComponent — edit resource displayName/description
│       │       └── action-form-dialog/  # ActionFormDialogComponent — create/edit action with name pattern validation
│       │   └── feature-flags/
│       │       ├── feature-flag-list/        # FeatureFlagListComponent — mat-table desktop / card-list handset (via LayoutService.isHandset()), per-row toggle/edit/delete, mat-fab on handset
│       │       ├── feature-flag-form-dialog/ # FeatureFlagFormDialogComponent — top form (key, description, environments chip-grid, enabled, public) + embedded rules editor; uses Wide dialog size on desktop, .app-dialog-fullscreen-mobile panelClass on handset
│       │       └── feature-flag-rule-row/    # FeatureFlagRuleRowComponent — single rule editor, payload editor per type (user chip+autocomplete via UserService.searchCursor with 250 ms debounce, role chip+autocomplete from RoleService.getAll(), percentage discrete slider with 5% step + static value label, attribute field+op+value+customKey with chips for op=in and mat-datepicker for op=before/after), include/exclude effect surfaced via [data-effect] colored left-border + tinted background on exclude, .vertical class on handset
│       │   └── billing/
│       │       └── billing-admin-list/        # BillingAdminListComponent — read-only Subscriptions + Invoices tables (mat-table desktop / card-list handset), per-row cancel (period-end/immediate menu + confirm) and refund (confirm); shared status-chip mixin with billing settings
│       ├── services/       # RoleService (HTTP → /api/v1/roles), RbacAdminService (HTTP → /api/v1/rbac/*), FeatureFlagsAdminService (HTTP → /api/v1/admin/feature-flags/*; If-Match version on PATCH), BillingAdminService (HTTP → /api/v1/admin/billing/*: subscriptions, invoices, cancel, refund)
│       └── store/          # RolesStore (route-level), ResourcesStore (route-level: resources, actions, loading), FeatureFlagsAdminStore (route-level: signalStore + withEntities<FeatureFlagResponse>), BillingAdminStore (route-level: subscriptions, invoices, cancel, refund)
│   └── billing/            # Self-service billing (pricing, checkout return, settings); routes/nav gated on the public `billing` flag (hidden until a provider is configured)
│       ├── billing.routes.ts # Lazy child routes under /billing; billingAvailableGuard on the parent (flag check, no auth), authGuard on settings/success/cancel; provides BillingStore
│       ├── components/
│       │   ├── pricing-page/      # PricingPageComponent — plan cards (featured Pro), region control (Auto/Russia/International, authed only), Choose → checkout (anonymous → /login), one-time purchases section (authed, non-empty catalog): product cards + donation cards; Buy/Pay parks the session ref in sessionStorage, then provider redirect (or straight to /billing/success when the provider completes client-side)
│       │   ├── plan-card/         # PlanCardComponent — presentational tier card; featured = raised + accent + "Most popular" chip; emits choose
│       │   ├── product-card/      # ProductCardComponent — one-time sku/credits ticket card: tonal icon, unlocked-entitlement meta (+ duration), price/Buy stub split by a dashed rule; emits buy
│       │   ├── donation-card/     # DonationCardComponent — custom-amount product form: quick presets (3×/5× the catalog minimum), bounded custom amount (Signal Forms validation against the catalog bounds), optional note (→ receipt), pay button with the live amount; emits donate
│       │   ├── billing-settings/  # BillingSettingsComponent — current plan + status chip, change-plan dialog (hidden for past_due / pending cancellation), cancel (confirm dialog), credits wallet card, payment method + update action (provider-hosted redirect), usage meter (usage-mode subs), invoices (table desktop / cards handset)
│       │   ├── credits-card/      # CreditsCardComponent — prepaid-credit wallet card: tonal toll icon + display-size unit figure (ticket vocabulary shared with product-card, dashed punch line before the action), zero state ("0 credits — top up", filled Top up → pricing), overdrawn state (error palette + usage-paused hint), positive state (outlined Buy credits)
│       │   ├── change-plan-dialog/ # ChangePlanDialogComponent — billing-mode toggle (fixed / pay-as-you-go), same-mode plan targets priced for the sub's provider, live proration mini-ledger from /change/preview (split credit/charge for YooKassa, net-only for Paddle, "Refund due" on negative net, trial note); closes with the chosen plan key, settings applies
│       │   ├── usage-meter/       # UsageMeterComponent — current-period usage card: unit readout, quota gauge (included = primary, overage = error tone; hidden when the plan includes no units), money mini-ledger ending in the accrued amount
│       │   └── checkout-return/   # CheckoutReturnComponent — /billing/success polls the subscription until active, or — when a pending one-time purchase is parked in sessionStorage — polls the invoices for the paid one_time invoice keyed by the provider payment ref, ending in a thank-you card; /billing/cancel neutral state (mode via route data), clears any pending purchase
│       ├── services/       # BillingService (HTTP → /api/v1/billing/*: plans, products, subscription, invoices, payment-method (GET/POST), usage, credits, checkout, purchase, subscription/change (+ /preview), subscription/cancel, region)
│       ├── store/          # BillingStore — route-level signalStore (plans, products, subscription, invoices, paymentMethod, usage, credits, region); loadPricing/loadSettings/checkout/purchase/refreshInvoices/changePlan/startPaymentMethodUpdate/cancel/setRegion
│       ├── guards/         # billingAvailableGuard — awaits flag load, allows when the `billing` flag resolves true, else redirects home (no auth requirement → public pricing)
│       └── utils/          # billing-format — formatMoney (minor units → Intl currency), formatUnits (locale-grouped credit units, sign kept), resolveDisplayProvider (region or language heuristic), planPriceFor/productPriceFor, parseAmountToMinor; pending-purchase — sessionStorage hand-off between purchase start and the checkout return
└── shared/
    ├── components/
    │   ├── confirm-dialog/            # ConfirmDialogComponent (desktop) + ConfirmBottomSheetComponent (handset)
    │   ├── keyboard-shortcuts-help/   # KeyboardShortcutsHelpComponent — Material dialog listing active shortcuts grouped by category
    │   ├── password-strength/         # PasswordStrengthComponent — 4-bar meter + aria-live label, score 0..4 mapped to PASSWORD_REGEX rules; used in register, profile, reset-password
    │   ├── password-toggle/           # PasswordToggleComponent (reusable password visibility toggle)
    │   └── captcha-widget/            # CaptchaWidgetComponent — Cloudflare Turnstile soft-trigger widget (renders only when register/forgot-password backend returns CAPTCHA_REQUIRED, fed by CaptchaService config + lazy script loader)
    ├── forms/              # AppFormFieldComponent (Signal Forms wrapper), ChipsAutocompleteComponent (mat-chip-grid + mat-autocomplete: free-text mode or static/async option lists), AriaErrorDirective, DEFAULT_ERROR_KEYS registry
    ├── models/             # user.types
    ├── services/           # AdaptiveDialogService — opens confirm dialogs as bottom sheets (handset) or dialogs (desktop)
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
| `/admin/users` | UserListComponent | permissionGuard('search', 'User') |
| `/admin/users/:id` | UserDetailComponent | permissionGuard('read', 'User') |
| `/admin/users/:id/edit` | UserEditComponent | instancePermissionGuard('update', 'User') |
| `/admin/users/:id/permissions` | UserPermissionsComponent | permissionGuard('read', 'User') |
| `/admin/roles` | RoleListComponent | permissionGuard('read', 'Role') |
| `/admin/resources` | ResourceListComponent | permissionGuard('read', 'Permission') |
| `/admin/feature-flags` | FeatureFlagListComponent | permissionGuard('manage', 'FeatureFlag') |
| `/admin/billing` | BillingAdminListComponent | permissionGuard('manage', 'Billing') |
| `/billing` | PricingPageComponent | billingAvailableGuard (public — anonymous pricing) |
| `/billing/settings` | BillingSettingsComponent | billingAvailableGuard + authGuard |
| `/billing/success` | CheckoutReturnComponent | billingAvailableGuard + authGuard |
| `/billing/cancel` | CheckoutReturnComponent | billingAvailableGuard + authGuard |
| `/verify-email` | VerifyEmailComponent | - |
| `/confirm-email-change` | ConfirmEmailChangeComponent | - |
| `/forgot-password` | ForgotPasswordComponent | guestGuard |
| `/reset-password` | ResetPasswordComponent | guestGuard |
| `/oauth/callback` | OAuthCallbackComponent | - |
| `/forbidden` | ForbiddenComponent | - |
| `/**` | PageNotFoundComponent | - |

### State Management

NgRx Signal Store (`@ngrx/signals`):

- **AuthStore** (`providedIn: 'root'`) — pure state container. State: `accessToken` (in-memory signal only, never persisted), `user` (persisted to `localStorage` as `auth_user` key for page-reload detection), `ability: AppAbility | null`. Computed: `isAuthenticated` (access token present), `user`, `roles`. Methods: `hasPermissions({ action, subject, instance? })`, `setRules(rules)`, `hasPersistedUser()`, `saveAuthResponse()`, `clearSession()`. No `HttpClient` dependency. RBAC checks always go through `hasPermissions` — never compare role names against the `'admin'` string (use `SYSTEM_ROLES.ADMIN` from `@app/shared/constants` for the rare display-only label)
- **CaptchaService** (`providedIn: 'root'`) — fetches `/api/v1/auth/captcha-config` once per session (cached in a signal), lazily injects the Cloudflare Turnstile script (`https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`), exposes `loadConfig()` and `loadScript()` consumed by `CaptchaWidgetComponent`. Falls back to `enabled: false` if the config request fails so auth flows continue working
- **AuthService** (`providedIn: 'root'`) — HTTP operations (login/register/logout/refresh/profile/OAuth accounts/`fetchPermissions(): Promise<void>`/`fetchRbacMetadata(): Promise<void>`). `register(data, captchaToken?)` and `forgotPassword(email, captchaToken?)` accept an optional Turnstile token included in the body when provided. `login()` uses `switchMap` to await `fetchPermissions()` before emitting — ensures permissions are loaded before route guards evaluate. `refreshTokens()` POSTs `{}` — the `refresh_token` HttpOnly cookie is sent automatically by the browser. `provideAppInitializer` awaits `fetchPermissions().then(() => fetchRbacMetadata())` for authenticated users, or attempts a cookie-refresh first when `hasPersistedUser()` is true (page reload with no in-memory token). `fetchRbacMetadata()` is permission-gated: `GET /rbac/metadata` requires `permissions:read` on the server, so the method resolves without a request when `hasPermissions({ action: 'read', subject: 'Permission' })` is false — callers must load permissions first. When permitted it implements stale-while-revalidate: returns immediately if data is cached in `RbacMetadataStore`, refreshes in background
- **UsersStore** (route-level at `/users`) — entity-based store with `withEntities<User>()`. Unified state: `filters: UserSearch` (empty = all users, filled = search via `GET /users/search`), single `load()`/`loadMore()` pair with **infinite scroll** (page size 20; `upsertEntities` appends; `hasMore` computed signal drives sentinel visibility; `isLoadingMore` shows spinner). `setFilters()` and `setSorting()` update state; component calls `load()` after each change
- **RbacMetadataStore** (`providedIn: 'root'`) — NgRx Signal Store with stale-while-revalidate localStorage caching for resources/actions metadata. Loaded at bootstrap via `AuthService.fetchRbacMetadata()` (only for users holding `permissions:read`; the server gates the endpoint the same way). Cleared on logout via `clear()` so the previous user's role/permission structure does not persist on shared devices. Computed: `subjectMap` (resource name to CASL subject)
- **ThemeService** — `theme` signal (`'light'` | `'dark'`), system preference detection, persists to localStorage
- **LanguageService** — `lang` signal (`'en'` | `'ru'`), reads `localStorage` → `navigator.language` → `'en'` fallback; on `setLanguage()` updates Transloco active lang, registers Angular locale data, sets `document.documentElement.lang`; `LOCALE_ID` provided via factory from this service
- **DisplayPreferencesService** — `density` signal (level `0`–`5`, default `0`), persisted to `localStorage` (`display-density`) and applied via an `effect` that sets `data-ui-density` on `<html>`; instantiated at bootstrap through `provideAppInitializer` so the saved value applies before first paint. Surfaced as the "Interface density" slider in Profile → Preferences. Overall size is intentionally left to the browser's own zoom — this preference only controls layout compactness
- **NotificationsService** (`providedIn: 'root'`) — SSE client using `HttpClient` with `observe: 'events'` so the JWT interceptor attaches `Authorization: Bearer` automatically. Parses `HttpDownloadProgressEvent.partialText` with offset tracking. Exposes: `sessionInvalidated$` (calls `tokenService.forceLogout()`), `permissionsUpdated$` (triggers `authService.fetchPermissions()` followed by the permission-gated `fetchRbacMetadata()`), `userCrudEvents$` (drives user list refresh). `connect()` called after login and session restore; `disconnect()` called on logout. Exponential backoff retry (3 s → 60 s cap, up to 10 retries, `resetOnSuccess`); auto-reconnects after retry exhaustion or server-initiated close if still authenticated. Server sends 30 s heartbeat (empty `data:` frames) to prevent proxy idle timeout
- **NotifyService** (`providedIn: 'root'`) — centralised `MatSnackBar` helper. Methods: `success(messageKey, params?)`, `info(messageKey, params?)`, `warn(messageKey, params?)`, `error(messageKey, params?)`, `error(httpError, fallbackKey?)`. Translates the message via `TranslocoService`, uses a translated `common.close` action, and relies on `MAT_SNACK_BAR_DEFAULT_OPTIONS` for duration/position so call sites don't repeat config. The `HttpErrorResponse` overload mirrors the `errorInterceptor` parsing chain: prefer translated `errorKey`, then server `message`, then translated `fallbackKey`, else status code

### HTTP Interceptors

1. **errorInterceptor** — catches errors, dispatches snackbar notifications via `NotifyService.error(httpErrorResponse)`, skips 401s. `NotifyService` performs the `errorKey > message > status` parsing chain (translated `errorKey` if present, otherwise server-provided `message`, otherwise HTTP status). On first 403: silently re-fetches `GET /auth/permissions`, calls `AuthStore.setRules()` (which triggers `RequirePermissionsDirective` via `effect()`), then retries the original request once. `RBAC_RETRY_CONTEXT` token prevents retry loops. Permissions-fetch failure and retry failure are handled separately and notify with the corresponding error.
2. **jwtInterceptor** — attaches `Authorization: Bearer` header, handles 401 with token refresh + request retry, uses `shareReplay(1)` to prevent concurrent refreshes

### Path Aliases

| Alias | Path |
|-------|------|
| `@core/*` | `src/app/core/*` |
| `@features/*` | `src/app/features/*` |
| `@shared/*` | `src/app/shared/*` |
| `@environments/*` | `src/environments/*` |
| `@app/shared/*` | `../shared/src/*` (shared types/constants across all 3 workspaces) |

## Feature flags — using the client primitives

Server-side, a flag is an entity with optional rules (user / role / percentage / attribute, include or exclude). Clients only ever see **evaluated booleans** — never the raw rules — because the rule set is admin-only configuration and could leak segmentation strategy.

The client core lives in `src/app/features/feature-flags/`:

| Piece | Use it for |
|-------|------------|
| `FeatureFlagsStore` (`providedIn: 'root'`) | Read the evaluated flag map from anywhere. `flags()` → `Record<string, boolean>`; `loaded()` → `boolean`; `isEnabled(key)` → `Signal<boolean>` (per-key memoised computed, shared across consumers of the same key) |
| `featureFlagGuard(key, redirectTo?)` | Route-level gating: `canActivate: [featureFlagGuard('new-dashboard')]`. Runs `ensureAuthenticated()` first, then `isEnabled(key)`; redirects to `redirectTo` (default `/forbidden`) on miss |
| `HasFeatureDirective` — `*nxsHasFeature` | Template gating with an optional `nxsHasFeatureElse` fallback `<ng-template>`. Reactive to store updates via `effect()` |
| `FeatureEnabledPipe` — `\| featureEnabled` | Attribute bindings. `pure: false` because the value is sourced from the store signal, not the pipe arg — single property lookup per CD cycle |

### Typical patterns

Route gate (lazy admin page hidden behind a flag):

```ts
// app.routes.ts
{
  path: 'new-dashboard',
  loadComponent: () => import('./features/dashboard/new-dashboard.component')
    .then((c) => c.NewDashboardComponent),
  canActivate: [featureFlagGuard('new-dashboard')]
}
```

Template gate with a "coming soon" placeholder:

```html
<ng-template #placeholder>
  <p class="muted">{{ t('common.comingSoon') }}</p>
</ng-template>

<nxs-new-dashboard *nxsHasFeature="'new-dashboard'; else placeholder" />
```

Attribute binding (disable an action while the flag is off):

```html
<button matButton="filled"
  [disabled]="!('beta-export' | featureEnabled)"
  (click)="exportToCSV()">
  {{ t('reports.exportButton') }}
</button>
```

### Lifecycle

`FeatureFlagsStore.load()` runs at bootstrap via `provideAppInitializer` for authenticated callers (alongside `fetchPermissions()` and `fetchRbacMetadata()`) AND for anonymous visitors (non-blocking, so public flags can gate first-paint placeholders). On logout the store is `clear()`-ed.

Live reactivity: `NotificationsService.featureFlagsUpdated$` (a filter on the SSE stream) triggers `featureFlagsStore.reload()` whenever the server broadcasts `{ type: 'feature_flags_updated' }`. The store's per-key computed signals propagate the new value, and `*nxsHasFeature` / `featureEnabled` re-render without a page reload.

Role-change is special-cased: `permissionsUpdated$` ALSO calls `reload()` because role-bound rules can flip for that user when their roles change.

### Admin

`/admin/feature-flags` is the management UI. Guarded by `permissionGuard('manage', 'FeatureFlag')` and exposed as the fifth tab in `AdminPanelComponent`. Components live under `features/admin/components/feature-flags/`:

- **`FeatureFlagListComponent`** — `mat-table` on desktop, `mat-card` list with a pinned-bottom `mat-fab` on handset (switched via `LayoutService.isHandset()`). Per-row toggle / edit / delete. Toggling a flag **on** when it has no include-effect rules first asks for confirmation — such a flag evaluates `true` for every authenticated user (the shared evaluator defaults to on with no include rules); disabling and flags that already target a subset flip silently.
- **`FeatureFlagFormDialogComponent`** — top form (key, description, environments, enabled, public) + embedded rules editor. Opens at `DialogSize.Wide` on desktop, with the `.app-dialog-fullscreen-mobile` panel-class (in `_dialogs.scss`) on handset for a `100vw × 100dvh` edge-to-edge layout with sticky title + actions. Rule order on save is the array order: `priority: i` is synthesized from the rendered index before send (server contract still requires `priority`). `public` carries helper text clarifying it gates **anonymous** visibility only; saving an enabled flag with no include rules triggers the same "enable for everyone" confirmation as the list toggle.
- **`FeatureFlagRuleRowComponent`** — single rule editor. Payload editor per type: comma-separated IDs for `user` / `role`, `mat-slider` + numeric input pair for `percentage`, field + op + value (+ conditional `customKey`) for `attribute`.

State + HTTP live in `features/admin/{store,services}`:
- **`FeatureFlagsAdminStore`** — route-level `signalStore + withEntities<FeatureFlagResponse>`, mirrors `RolesStore`. `load()` via `rxMethod`; CRUD methods return `Observable` so callers can surface per-call notifications.
- **`FeatureFlagsAdminService`** — HTTP wrapper around `/api/v1/admin/feature-flags/*`. `update()` sets `If-Match: <expectedVersion>` for optimistic locking; the server returns HTTP 409 (`errors.featureFlags.versionConflict`) when the version is stale.

## Styling

- **Angular Material** + Angular CDK for UI components
- **SCSS architecture** with themes, utilities, and component styles
- **Light/dark theming** via Material M3 system tokens (`--mat-sys-*`) + app-level semantic tokens (`--app-*` for success/info/warning/text-tertiary/color-scheme)
- **Stylelint** with recess property order

```
src/styles/
├── abstracts/        # Variables, functions, mixins
├── base/             # Reset, typography, animations
├── themes/           # Light and dark Material themes + CSS vars
├── layout/           # Containers, grids
├── components/       # Cards, forms, loading, tables, dialogs (_dialogs.scss — global dialog overrides), buttons (_buttons.scss — .app-btn-danger destructive utility, .app-btn-loading spinner+label row for a button's loading branch), chips (_chips.scss — .app-chip-danger destructive utility)
└── utilities/        # Flex, spacing, text, visibility helpers
```

All size values use `func.rem(N)` (pixels → rem conversion) — never hardcoded `px`/`rem` literals. Global dialog styles live in `_dialogs.scss` (title padding, `::before` reset, bug #26352 fix, plus opt-in panel classes: `.app-dialog-fullscreen-mobile` for edge-to-edge handset dialogs and `.app-dialog-tall` which raises the content `max-height` cap from 65vh to 80vh). Dialog sizes are managed via `DialogSize` enum + `dialogSizeConfig()` in `shared/utils/dialog.utils.ts`.

**Spacing tokens** — `_variables.scss` exposes both a primitive scale (`$spacing-xxs/xs/sm/md/lg/xl/xxl`) and a semantic layer on top (`$space-component-gap`, `$space-form-row-gap`, `$space-section-gap`). Mixins and shared component styles use the semantic tokens so the scale can be re-tuned in one place; primitives remain available for one-off / non-semantic spots.

**Runtime density** — `themes/_density.scss` pre-generates `[data-ui-density="1..5"]` classes (each `@include mat.all-component-densities(-N)`) so layout compactness is switchable at runtime; `DisplayPreferencesService` sets the attribute on `<html>` from the user's "Interface density" preference (Material density is otherwise a build-time mixin).

**M3 colour API** — the project uses an M3 theme (`@include mat.theme(...)`); the M2 `color="primary|accent|warn"` attribute is a silent no-op and is unconditionally banned by `lint:no-mat-color` (`client/scripts/lint-no-mat-color.mjs`) — any reintroduction fails CI. For destructive actions, apply `class="app-btn-danger"` on any matButton/matIconButton or `class="app-chip-danger"` on a `<mat-chip>` instead — both are token-driven (`var(--mat-sys-error)` / `var(--mat-sys-error-container)`) and respect dark/light themes automatically.

**Accessibility (WCAG 2.1 AA):** skip link rendered at the top of `app.component.html` (translated via `common.skipToContent`) targets `id="main"` on `<main role="main">`, satisfying WCAG 2.4.1 *Bypass Blocks*; sidenav nav links have `aria-label` + `aria-current`; sidenav toggle has `aria-label` + `aria-expanded`; decorative `mat-icon` elements carry `aria-hidden="true"`; toolbar control `aria-label`s are bound to transloco strings.

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
  - `helpers.ts` — `loginViaUi()`, `loginViaUiKeepSse()` (variant that skips `networkidle` so tests can hold a real SSE stream open), `expectAuthRedirect()`, `expectForbiddenRedirect()`
- Test structure: organized by module in `e2e/auth/`, `e2e/users/`, and `e2e/admin/`
- **Accessibility**: `e2e/a11y.spec.ts` runs `@axe-core/playwright` (WCAG 2.1 AA) against every major route; `e2e/keyboard-nav.spec.ts` verifies keyboard-only flows (login, sidenav, user-edit, dialog focus trap)
- **Live RBAC + auth regression net**: refresh-token reuse detection (`refresh-token-reuse.spec.ts`), SSE-driven role revocation hides admin link (`role-revocation-via-sse.spec.ts`), admin-on-/admin auto-redirect to /forbidden (`admin/admin-panel-permission-loss.spec.ts`), reactive 401 → refresh → retry (`reactive-token-refresh.spec.ts`), logout + browser Back navigation (`logout-back-button.spec.ts`), OAuth unlink-last-provider safety (`oauth-unlink-last-provider.spec.ts`), wire-contract assertion that `auth_user.roles` is `RoleResponse[]` (`post-login-admin-badge.spec.ts`), SSE-driven feature-flag toggle propagation (`admin/feature-flags.spec.ts`)
- Coverage: 201 Playwright tests across auth/users/admin/billing/a11y/keyboard suites; 888 Vitest unit tests covering login, register, profile (incl. self-service email change), session-restore, lockout, email verification, password reset (with password confirmation), users list/detail/edit/search (including admin email-change confirmation dialog), admin roles/resources/feature-flags management, effective-permissions preview, admin-panel auto-redirect when permissions are revoked mid-session, a11y audit, keyboard navigation. Error translation tests verify `errorKey` → Transloco pipeline for login, register, and global interceptor snackbar.
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
| Angular | 21.2.17 |
| Angular Material | 21.2.14 |
| TypeScript | 5.9.3 |
| @ngrx/signals | 21.0.1 |
| @jsverse/transloco | 7.5.0 |
| RxJS | 7.8.2 |
| Vitest | 4.0.18 |
| Playwright | 1.61.0 |
| ESLint | 9.39.2 |
| Prettier | 3.8.1 |
| Stylelint | 17.1.1 |
| commitlint | 20.4.1 |
| commit-and-tag-version | 12.6.1 |
