# Client

Angular 21 SPA. It uses standalone components, an Angular Material M3 UI, JWT authentication, and a
light theme and a dark theme.

## Getting Started

```bash
npm install
npm start             # Dev server at http://localhost:4200 (proxies /api to backend)
```

The dev proxy (`proxy.conf.mjs`) sends `/api` and `/ws` requests to `BACKEND_URL`. The default value
of `BACKEND_URL` is `http://localhost:3000`.

## Commands

| Task | Command |
|------|---------|
| Dev server | `npm start` |
| Build | `npm run build` |
| Typecheck | `npm run typecheck` runs `tsc --noEmit` on the `app` project and the `spec` project. Do not point it at the base `tsconfig.json`. That file is a shared base and not a compilable program. The `app` project needs `types: []`, the specs need `lib: esnext.disposable`, and e2e needs `types: ["node"]` |
| Typecheck e2e | `npm run typecheck:e2e` uses `tsconfig.e2e.json`, which covers `e2e/**` and `playwright.config.ts`. This gate is separate because the fixtures import mock-server sources. Thus the gate needs `mock-server/` installed. `ng build` covers the `app` project only, and Playwright transpiles the tests without a typecheck. Thus no other gate examines `e2e/` |
| Lint (TS + SCSS + checks) | `npm run lint` |
| Lint fix (TS + SCSS) | `npm run lint:fix` |
| Lint SCSS only | `npm run lint:styles` |
| Format check | `npm run format:check` examines `src/`, `e2e/`, `scripts/` and the root-level configuration files |
| Format | `npm run format` uses the same scope and writes the corrections |
| Unit tests | `npm test` (Vitest) |
| E2E tests | `npm run test:e2e` (Playwright) |
| E2E tests (UI) | `npm run test:e2e:ui` |
| Audit dependencies | `npm run audit:ci` runs `npm audit --audit-level=high --omit=dev` through `scripts/audit-ci.mjs`. This is the same gate that CI applies. The script retries a failed registry endpoint, but it never retries a true finding |
| Release | `npm run release` increases the versions, makes `CHANGELOG.md`, and makes a git tag |

## Architecture

### Component Structure

All components are standalone components. No component uses an NgModule. All components use `OnPush`
change detection, and the router loads the routes on demand.

```
src/app/
├── core/                   # Header, sidenav, theme toggle, storage and session-storage services,
│                           # error interceptor, 404 page, NotificationsService (SSE).
│                           # LayoutService maps CDK Breakpoints to the isHandset, isTablet and
│                           # isWeb signals.
│                           # RoleCatalogService reads GET /api/v1/roles. This is the unpaginated
│                           # role catalog for each picker and filter. It stays out of
│                           # features/admin, so that users and admin do not depend on each other.
├── features/
│   ├── auth/               # Login, register, profile, OAuth callback, verify-email,
│   │                       # forgot-password, reset-password, forbidden,
│   │                       # two-factor (the enrolment card on the profile page;
│   │                       # the login card holds the code step itself)
│   │   ├── casl/           # app-ability.ts holds AppAbility, Actions and Subjects.
│   │   │                   # Subjects contains the generated KnownSubjects and AnyObject.
│   │   │                   # PermissionCheck holds action, subject and an optional instance.
│   │   ├── directives/     # RequirePermissionsDirective supplies
│   │   │                   # *appRequirePermissions="check; else fallbackTpl".
│   │   │                   # The optional else template shows a fallback view when access is
│   │   │                   # denied, for example a disabled button with a tooltip.
│   │   ├── guards/         # authGuard, guestGuard, permissionGuard(action, subject), and
│   │   │                   # instancePermissionGuard(action, subject, instanceFactory).
│   │   │                   # Every permission guard first calls mfaEnrolmentRedirect(): an account
│   │   │                   # that owes the two-factor enrolment its role demands goes to /profile,
│   │   │                   # where the enrolment card is, because the server refuses the same
│   │   │                   # routes with 403 errors.auth.mfaEnrolmentRequired.
│   │   │                   # All guards use ensureAuthenticated(). If no user was persisted, that
│   │   │                   # function goes directly to /login. It does not start a refresh, which
│   │   │                   # can only answer 401.
│   │   │                   # Each redirect returns a UrlTree. No guard uses router.navigate() with
│   │   │                   # a false result, because the Angular CanActivate contract forbids it.
│   │   │                   # Thus a guard stays a pure function of the store.
│   │   ├── utils/          # ensureAuthenticated is the guard funnel.
│   │   │                   # safeReturnUrl keeps a post-login redirect on our own origin.
│   │   │                   # isSameOriginUrl, loginUrlTree (the value a guard returns),
│   │   │                   # navigateToLogin (imperative, for the logout paths in a service),
│   │   │                   # and the token-refresh predicates.
│   │   ├── interceptors/   # jwtInterceptor
│   │   ├── services/       # AuthService owns the HTTP calls, the refresh schedule and
│   │   │                   # fetchPermissions(): Promise<void>. Also rbac-metadata.service.ts.
│   │   └── store/          # AuthStore is an NgRx Signal Store. Its state holds accessToken (in
│   │                       # memory), user (in localStorage as auth_user),
│   │                       # ability: AppAbility | null and mfaMandatory (the server policy, read
│   │                       # from GET /auth/permissions, never persisted). The computed
│   │                       # mustEnrolMfa() is mfaMandatory AND a profile with no factor.
│   │                       # Also RbacMetadataStore.
│   ├── feature-flags/      # Client core of the feature-flags subsystem
│   │   ├── services/       # FeatureFlagService calls HttpClient.get('/api/v1/feature-flags',
│   │   │                   # { withCredentials: true }). It uses the silent-error context, thus a
│   │   │                   # bootstrap failure does not show a toast.
│   │   ├── store/          # FeatureFlagsStore is an NgRx Signal Store with { providedIn: 'root' }.
│   │   │                   # State: { flags: Record<string, boolean>; loaded: boolean }.
│   │   │                   # Methods: load(), reload(), clear(), and isEnabled(key), which returns
│   │   │                   # a memoized computed signal for each key.
│   │   ├── guards/         # featureFlagGuard(key, redirectTo = '/forbidden') first calls
│   │   │                   # ensureAuthenticated(), thus an expired token gets a refresh before
│   │   │                   # the flag check. On a miss it returns the redirectTo UrlTree.
│   │   ├── directives/     # HasFeatureDirective supplies *nxsHasFeature="'flag-key'". It uses
│   │   │                   # effect(). The optional nxsHasFeatureElse input takes a TemplateRef
│   │   │                   # fallback, for example a "coming soon" placeholder.
│   │   └── pipes/          # FeatureEnabledPipe supplies {{ 'flag-key' | featureEnabled }} for an
│   │                       # attribute binding. It sets pure: false, because the value comes from
│   │                       # the store signal. The cost is one property read for each check cycle.
│   ├── users/              # User list with inline filters, detail, edit, and effective
│   │   │                   # permissions (admin)
│   │   ├── services/       # UserService reads /api/v1/users. UserRoleService assigns a role to
│   │   │                   # one user, or removes it, through
│   │   │                   # /roles/assign/:userId[/:roleId].
│   │   ├── components/
│   │   │   ├── user-table/        # UserTableComponent is the shared table. It has sorting and
│   │   │   │                      # actions, and no paginator. It shows on a tablet or a desktop.
│   │   │   ├── user-card-list/    # UserCardListComponent is a mat-card grid with an action menu
│   │   │   │                      # for each user. It shows on a handset, through
│   │   │   │                      # LayoutService.isHandset().
│   │   │   └── user-permissions/  # UserPermissionsComponent is a read-only preview of the
│   │   │                          # effective permissions. It groups them by resource in a
│   │   │                          # mat-accordion and shows a deny indicator.
│   │   └── store/          # UsersStore is an NgRx Signal Store at route level.
│   ├── admin/              # Admin panel: roles, resources and users
│       ├── admin.routes.ts # Child routes below /admin. The router loads them on demand.
│       ├── components/
│       │   ├── admin-panel/             # AdminPanelComponent is the tabbed shell for Users,
│       │   │                            # Roles and Resources. If the session loses the admin
│       │   │                            # permissions, an effect() sends the user to /forbidden.
│       │   │                            # The effect calls the shared canAccessAdminPanel helper,
│       │   │                            # which adminPanelGuard and the admin entry in
│       │   │                            # SidenavStateService.navLinks also use. That helper is
│       │   │                            # false while mustEnrolMfa() is true, so the entry point
│       │   │                            # is hidden instead of failing.
│       │   │                            # The effect runs only when isAuthenticated() is true,
│       │   │                            # thus a logout does not flash the /forbidden page.
│       │   ├── roles/
│       │   │   ├── role-list/           # RoleListComponent is a data table with create, edit and
│       │   │   │                        # delete actions.
│       │   │   ├── role-form-dialog/    # RoleFormDialogComponent creates and edits a role. It
│       │   │   │                        # has a name field and a description field.
│       │   │   └── role-permissions-dialog/ # RolePermissionsDialogComponent is the permission
│       │   │                                # matrix. It holds the CASL condition editors and an
│       │   │                                # Allow and Deny toggle (effect) for each permission.
│       │   └── resources/
│       │       ├── resource-list/       # ResourceListComponent has two sections: a Resources
│       │       │                        # table and an Actions table.
│       │       ├── resource-form-dialog/ # ResourceFormDialogComponent edits the displayName and
│       │       │                         # description of a resource.
│       │       └── action-form-dialog/  # ActionFormDialogComponent creates and edits an action.
│       │                                # It validates the name pattern.
│       │   └── feature-flags/
│       │       ├── feature-flag-list/        # FeatureFlagListComponent shows a mat-table on a
│       │       │                             # desktop and a card list on a handset, through
│       │       │                             # LayoutService.isHandset(). Each row has a toggle,
│       │       │                             # an edit action and a delete action. A handset also
│       │       │                             # shows a mat-fab.
│       │       ├── feature-flag-form-dialog/ # FeatureFlagFormDialogComponent has a top form and
│       │       │                             # an embedded rules editor. The top form holds key,
│       │       │                             # description, an environments chip grid (options
│       │       │                             # only), enabled and public. The dialog uses the
│       │       │                             # Wide size on a desktop and the
│       │       │                             # .app-dialog-fullscreen-mobile panel class on a
│       │       │                             # handset.
│       │       └── feature-flag-rule-row/    # FeatureFlagRuleRowComponent edits one rule. Each
│       │                                     # rule type has its own payload editor. A user rule
│       │                                     # uses a chip field with an autocomplete fed by
│       │                                     # UserService.searchCursor with a 250 ms debounce.
│       │                                     # A role rule uses a chip field fed by
│       │                                     # RoleCatalogService.getAll(). A percentage rule
│       │                                     # uses a discrete slider with a 5% step and a static
│       │                                     # value label. An attribute rule has field, op,
│       │                                     # value and customKey. The customKey box is an
│       │                                     # autocomplete over the keys that
│       │                                     # GET /admin/feature-flags/attribute-keys reports.
│       │                                     # It shows chips for op=in and
│       │                                     # a mat-datepicker for op=before and op=after. The
│       │                                     # value box keeps the primitive type of the stored
│       │                                     # value: true, false and an exact number stay
│       │                                     # scalars, because the evaluator compares with ===.
│       │                                     # The dialog passes the reason the server would
│       │                                     # reject the row, and the row shows it in .rule-error.
│       │                                     # The [data-effect] attribute shows the include or
│       │                                     # exclude effect with a colored left border. An
│       │                                     # exclude rule also gets a tinted background. A
│       │                                     # handset adds the .vertical class.
│       │   └── billing/
│       │       └── billing-admin-list/        # BillingAdminListComponent shows read-only
│       │                                      # Subscriptions and Invoices tables. It uses a
│       │                                      # mat-table on a desktop and a card list on a
│       │                                      # handset. Each list has its own store, its own
│       │                                      # cursor pagination and its own infinite-scroll
│       │                                      # sentinel. Each row has a cancel action (a menu
│       │                                      # with period-end and immediate, plus a
│       │                                      # confirmation) and a refund action (a
│       │                                      # confirmation). The status-chip mixin is shared
│       │                                      # with the billing settings page.
│       ├── services/       # RoleService reads /api/v1/roles for role administration only. To
│       │                   # read the catalog, use the core RoleCatalogService.
│       │                   # RbacAdminService reads /api/v1/rbac/*.
│       │                   # FeatureFlagsAdminService reads /api/v1/admin/feature-flags/* and
│       │                   # sends an If-Match version on a PATCH.
│       │                   # BillingAdminService reads /api/v1/admin/billing/*: subscriptions,
│       │                   # invoices, cancel and refund.
│       └── store/          # RolesStore (route level).
│                           # ResourcesStore (route level: resources, actions, loading).
│                           # FeatureFlagsAdminStore (route level: signalStore with
│                           # withEntities<FeatureFlagResponse>).
│                           # BillingSubscriptionsStore and BillingInvoicesStore (route level, one
│                           # store for each list: withEntities with withCursorList, plus cancel
│                           # and refund).
│   └── billing/            # Self-service billing: pricing, checkout return and settings. The
│       │                   # routes and the navigation entry are gated on the public `billing`
│       │                   # flag, thus they stay hidden until a provider is configured.
│       ├── billing.routes.ts # Child routes below /billing, loaded on demand.
│       │                     # The parent route uses billingAvailableGuard, which checks the flag
│       │                     # and does not require authentication.
│       │                     # The settings, success and cancel routes also use authGuard.
│       │                     # The parent route provides BillingStore.
│       ├── components/
│       │   ├── pricing-page/      # PricingPageComponent shows the plan cards, with Pro as the
│       │   │                      # featured card. An authenticated user also gets the region
│       │   │                      # control (Auto, Russia, International). The Choose button
│       │   │                      # starts the checkout. An anonymous visitor goes to /login.
│       │   │                      # An authenticated user with a non-empty catalog also sees the
│       │   │                      # one-time purchases section, which holds the product cards and
│       │   │                      # the donation cards. The Buy and Pay buttons put the session
│       │   │                      # reference in sessionStorage. Then the browser goes to the
│       │   │                      # provider. If the provider completes the payment in the
│       │   │                      # browser, the app goes directly to /billing/success.
│       │   ├── plan-card/         # PlanCardComponent is a presentational tier card. A featured
│       │   │                      # card is raised, uses the accent color and shows a "Most
│       │   │                      # popular" chip. The component emits choose.
│       │   ├── product-card/      # ProductCardComponent is the ticket card for a one-time sku or
│       │   │                      # for credits. It has a tonal icon and shows the unlocked
│       │   │                      # entitlement and its duration. A dashed rule divides the price
│       │   │                      # from the Buy button. The component emits buy.
│       │   ├── donation-card/     # DonationCardComponent is the form for a product with a custom
│       │   │                      # amount. It has quick presets at 3 times and 5 times the
│       │   │                      # catalog minimum. Signal Forms validates the custom amount
│       │   │                      # against the catalog bounds. An optional note goes to the
│       │   │                      # receipt. The pay button shows the live amount. The component
│       │   │                      # emits donate.
│       │   ├── billing-settings/  # BillingSettingsComponent shows the current plan and a status
│       │   │                      # chip. It opens the change-plan dialog, which stays hidden for
│       │   │                      # the past_due status and for a pending cancellation. The
│       │   │                      # cancel action opens a confirmation dialog. For a metered plan
│       │   │                      # that dialog says that the closing period is charged. The page
│       │   │                      # also shows the credits wallet card, the payment method with
│       │   │                      # its update action (a redirect to the provider), the usage
│       │   │                      # meter for a usage-mode subscription, and the invoices. The
│       │   │                      # invoices use cursor pagination with infinite scroll. They
│       │   │                      # show as a table on a desktop and as cards on a handset.
│       │   ├── credits-card/      # CreditsCardComponent is the wallet card for prepaid credits.
│       │   │                      # It has a tonal toll icon and a display-size unit figure. It
│       │   │                      # shares the ticket vocabulary of product-card and puts a
│       │   │                      # dashed punch line before the action. The zero state shows "0
│       │   │                      # credits - top up" and a filled Top up button to the pricing
│       │   │                      # page. The overdrawn state uses the error palette and shows a
│       │   │                      # usage-paused hint. The positive state shows an outlined Buy
│       │   │                      # credits button.
│       │   ├── change-plan-dialog/ # ChangePlanDialogComponent has a billing-mode toggle for
│       │   │                       # fixed and pay-as-you-go. It shows the plan targets of the
│       │   │                       # same mode, priced for the provider of the subscription. A
│       │   │                       # live proration mini-ledger comes from /change/preview. For
│       │   │                       # YooKassa the ledger splits the credit and the charge. For
│       │   │                       # Paddle it shows the net value only. A negative net shows
│       │   │                       # "Refund due". A trial shows a note. The dialog closes with
│       │   │                       # the selected plan key, and the settings page applies it.
│       │   ├── usage-meter/       # UsageMeterComponent is the usage card for the current period.
│       │   │                      # It shows the unit readout and a quota gauge. The included
│       │   │                      # quantity uses the primary tone and the overage uses the error
│       │   │                      # tone. If the plan includes no units, the gauge stays hidden.
│       │   │                      # A money mini-ledger ends with the accrued amount.
│       │   └── checkout-return/   # CheckoutReturnComponent shows /billing/success and
│       │                          # /billing/cancel. The route data supplies the mode.
│       │                          # On success it polls the subscription until the status is
│       │                          # active. If sessionStorage holds a pending one-time purchase,
│       │                          # it polls the invoices for the paid one_time invoice with that
│       │                          # provider payment reference. Then it shows a thank-you card.
│       │                          # The cancel mode shows a neutral state and removes any pending
│       │                          # purchase.
│       ├── directives/     # HasEntitlementDirective supplies *nxsHasEntitlement="'reports'". It
│       │                   # has the same surface as HasFeatureDirective, but on the entitlement
│       │                   # axis. The optional nxsHasEntitlementElse TemplateRef can show an
│       │                   # upgrade prompt. The directive starts the lazy load of the store. It
│       │                   # denies access while the store is not loaded. It is advisory only,
│       │                   # because the server EntitlementGuard is the boundary.
│       ├── services/       # BillingService reads /api/v1/billing/*: plans, products,
│       │                   # subscription, invoices, payment-method (GET and POST), usage,
│       │                   # credits, entitlements, checkout, purchase, subscription/change with
│       │                   # /preview, subscription/cancel, and region.
│       │                   # CheckoutRedirectService is the only owner of the navigation to a
│       │                   # hosted checkout. It follows a session URL only when the URL is https
│       │                   # or same-origin. It blocks javascript:, data: and cross-origin http,
│       │                   # and shows a translated error.
│       ├── store/          # EntitlementsStore is a root signalStore. It mirrors
│       │                   # GET /billing/entitlements: { planKey, capabilities, limits, loaded }.
│       │                   # load() is lazy and starts on the first consumer, not at bootstrap,
│       │                   # because the read needs authentication and most sessions never use
│       │                   # it. reload() runs on the entitlements SSE push. clear() runs on
│       │                   # login and on both logout branches. has(capability) and limit(key)
│       │                   # are computed signals for each key. limit() takes the shared
│       │                   # EntitlementLimitKey union and not a free-form string.
│       │                   # The first consumer of limit() is the billing settings page. It shows
│       │                   # the concurrent-device allowance of the plan as
│       │                   # limit('sessions') ?? MAX_CONCURRENT_SESSIONS. It reads this mirror
│       │                   # and not PlanResponse.limits, which cannot express the Free fallback.
│       │                   # BillingStore is a route-level signalStore. It holds plans, products,
│       │                   # subscription, paymentMethod, usage, credits and region, plus the
│       │                   # invoice collection through withCursorList. Its methods are
│       │                   # loadPricing, loadSettings, checkout, purchase, refreshInvoices,
│       │                   # loadMoreInvoices, changePlan, startPaymentMethodUpdate, cancel and
│       │                   # setRegion.
│       ├── guards/         # billingAvailableGuard waits for the flag load. It permits access
│       │                   # when the `billing` flag is true. If not, it goes to the home page.
│       │                   # It does not require authentication, thus the pricing page is public.
│       └── utils/          # billing-format holds formatMoney (minor units to an Intl currency),
│                           # formatUnits (locale-grouped credit units that keep the sign),
│                           # resolveDisplayProvider (a heuristic on the region or the language),
│                           # planPriceFor, productPriceFor and parseAmountToMinor.
│                           # pending-purchase transfers data through sessionStorage between the
│                           # start of a purchase and the checkout return.
└── shared/
    ├── components/
    │   ├── confirm-dialog/            # ConfirmDialogComponent for a desktop and
    │   │                              # ConfirmBottomSheetComponent for a handset
    │   ├── keyboard-shortcuts-help/   # KeyboardShortcutsHelpComponent is a Material dialog. It
    │   │                              # lists the active shortcuts in category groups.
    │   ├── password-strength/         # PasswordStrengthComponent is a meter with 4 bars and an
    │   │                              # aria-live label. Length carries the score and character
    │   │                              # variety only shortens the way to the top, because the
    │   │                              # composition rules are gone. It advises on length while
    │   │                              # the value scores low. The register, profile and
    │   │                              # reset-password pages use it.
    │   ├── password-toggle/           # PasswordToggleComponent is the reusable toggle for
    │   │                              # password visibility.
    │   └── captcha-widget/            # CaptchaWidgetComponent is the soft-trigger widget for
    │                                  # Cloudflare Turnstile. It renders only when the register
    │                                  # or forgot-password endpoint returns CAPTCHA_REQUIRED. It
    │                                  # uses the CaptchaService configuration and the lazy script
    │                                  # loader.
    ├── forms/              # NxsFormFieldComponent (<nxs-form-field>) is the Signal Forms
    │                       # wrapper. NxsChipsAutocompleteComponent
    │                       # (<nxs-chips-autocomplete>) is a mat-chip-grid with a
    │                       # mat-autocomplete. It has a free-text mode and a mode with static or
    │                       # asynchronous option lists. DEFAULT_ERROR_KEYS is the error registry.
    │                       # This directory has no barrel. Import each module directly. Refer to
    │                       # "Import hygiene and barrels" in the root README.
    ├── models/             # user.types
    ├── directives/         # InfiniteScrollDirective (nxsInfiniteScroll) is the sentinel that
    │                       # each list page puts after its rows. It emits loadMore while hasMore
    │                       # is true and busy is false. It arms itself again after each page,
    │                       # thus a short first page still fills the viewport.
    │                       # TemplateBranch is the abstract base of the three gating directives:
    │                       # nxsRequirePermissions, nxsHasFeature and nxsHasEntitlement. It owns
    │                       # the then and else view-container bookkeeping. Thus each directive
    │                       # supplies only its predicate and its else template.
    ├── services/           # AdaptiveDialogService opens a confirm dialog as a bottom sheet on a
    │                       # handset and as a dialog on a desktop.
    ├── store/              # withCursorList<T>({ fallbackKey }) is the shared cursor-list feature
    │                       # that each list store composes. It owns the cursor bookkeeping, the
    │                       # in-flight guards, the append of the next page and the stale-response
    │                       # guard.
    └── utils/              # css.utils.
                            # dialog.utils holds the DialogSize enum and dialogSizeConfig().
                            # http-error.utils holds parseHttpErrorMessage, the single funnel for
                            # server error text.
                            # deep-equal.utils does a structural compare of JSON-shaped values and
                            # ignores the key order.
                            # pagination.utils holds CursorPageRequest, the cursorParams()
                            # HttpParams builder and CURSOR_PAGE_SIZE.
                            # role-display.utils holds roleIcon, isAdminRole,
                            # sortRolesForDisplay and overflowRoleNames.
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
| `/billing` | PricingPageComponent | billingAvailableGuard (public: anonymous pricing) |
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

Every row that names `permissionGuard`, `instancePermissionGuard` or `adminPanelGuard` also carries
the two-factor gate: while `MFA_REQUIRED_FOR_ADMINS` is on and the account holds a super role with
no enrolment, the guard answers with a redirect to `/profile` instead of the route.

### State Management

The project uses the NgRx Signal Store (`@ngrx/signals`).

#### AuthStore

`AuthStore` uses `providedIn: 'root'`. It is a pure state container and has no `HttpClient`
dependency.

State:

- `accessToken` is an in-memory signal. The app never persists it.
- `user` goes to `localStorage` with the key `auth_user`, for the detection of a page reload. The
  app reads the value back through the `isPersistedUser` guard in `store/storage-guards.ts`. Thus
  the app ignores a stale or malformed entry. It then starts in the logged-out state. It does not
  show a partial user.
- `ability` is an `AppAbility` or `null`.
- `mfaMandatory` is the server policy from `GET /auth/permissions`. It is true when the account
  holds a super role and the deployment demands a second factor from such an account. The app never
  persists it: a stale copy would gate a session the server admits, or open one it refuses.

Computed signals: `isAuthenticated` (an access token is present), `user`, `roles`, and
`mustEnrolMfa` (`mfaMandatory` and a profile that carries no factor). Every permission guard reads
`mustEnrolMfa` and redirects to `/profile`, where the enrolment card is.

Methods: `hasPermissions(check)`, `setRules(rules)`, `setMfaMandatory(flag)`, `hasPersistedUser()`,
`saveAuthResponse()` and `clearSession()`.

`hasPermissions(check)` accepts one check or an array of checks. **An empty array denies access.**
Without this rule, `[].every()` gives access to all callers. The method reads the ability signal
before that exit, thus a caller that reacts to the signal keeps its subscription.

Each RBAC check must use `hasPermissions`. Never compare a role name with the `'admin'` literal. For
a rare display-only label, use `SYSTEM_ROLES.ADMIN` from `@app/shared/constants`.

#### CaptchaService

`CaptchaService` uses `providedIn: 'root'`. It reads `/api/v1/auth/captcha-config` one time in each
session and keeps the result in a signal. It also injects the Cloudflare Turnstile script on demand
from `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`. It supplies
`loadConfig()` and `loadScript()` to `CaptchaWidgetComponent`.

**Neither method keeps a failure in the cache.** A failed configuration read rejects and removes the
in-flight promise. Thus the next widget retries the read. A cached `enabled: false` fallback would
keep the captcha off for the full tab. The server would then continue to answer `CAPTCHA_REQUIRED`
to a widget that can no longer get a site key.

A failed script load also removes the cached promise. The dead `<script>` element goes out of the
DOM, because an element that gave one `error` event never gives a second event. Thus a retry must
append a new element. `CaptchaWidgetComponent` shows `status: 'error'` after each of the two
rejections.

#### AuthService

`AuthService` uses `providedIn: 'root'`. It owns the HTTP operations: login, register, logout,
refresh, profile, the OAuth accounts, `fetchPermissions(): Promise<void>` and
`fetchRbacMetadata(): Promise<void>`.

`register(data, captchaToken?)` and `forgotPassword(email, captchaToken?)` accept an optional
Turnstile token. If the caller supplies the token, the method puts it in the body.

`login()` uses `switchMap` and waits for `fetchPermissions()` before it emits. Thus the permissions
are available before the route guards run.

`refreshTokens()` sends a POST with an empty body. The browser sends the `refresh_token` HttpOnly
cookie automatically. The app cannot abort this request, because the promise inside the Web Locks
callback owns it. Thus `TokenService.cancelRefresh()` increases a session epoch instead. A response
that arrives after a logout, a forced logout or a `session_invalidated` push resolves to `null`. Such
a response never writes the session back.

`logout()` does a refresh first when the in-memory access token has expired. A tab that slept through
the lifetime of its token wakes in that state. The refresh is necessary because `POST /auth/logout`
uses the JWT guard, and the interceptor does not apply its refresh-and-retry to that route. A POST
with a stale token answers 401. The refresh token then stays live on the server behind a logged-out
UI. If the refresh fails, the session is already invalid, and the code continues to the local
teardown.

The session teardown is one routine. `logout()` runs it on both branches.
`TokenService.forceLogout()` reaches it through the `sessionCleared$` subject, because `TokenService`
cannot import `AuthService`. Such an import closes a dependency cycle. Thus each exit path
disconnects the SSE stream. It also clears the session, the cached RBAC metadata, the feature flags
and the entitlements.

Three exit paths never reach `logout()`: `ensureAuthenticated` and `guestGuard` after a failed
refresh, and the `catch` block in `provideAppInitializer`. They run the same routine through the
public `clearSession()` delegate. A call to `AuthStore.clearSession()` clears only the token and the
persisted user.

A logout in one tab also ends the session in the other tabs. The constructor listens for the
`storage` event. That event fires in each other tab of the same origin, and never in the tab that
made the change. When `auth_user` goes away, the listener calls
`TokenService.forceLogout(router.url)`. This does a full teardown and makes no HTTP call, because the
other tab already revoked the session on the server. The tab then goes to `/login?returnUrl=`.
Without this listener, the access token of each other tab kept that tab operational, because the
token lives in the memory of the tab.

The listener is intentionally narrow. It reacts only when that one key in `localStorage` becomes
`null`. Thus a login or a profile save in another tab does not disturb this tab, because both
operations *write* the key. A change to another persisted key also does not disturb it. A tab with no
session stays where it is and does not go to `/login`.

`provideAppInitializer` waits for `fetchPermissions().then(() => fetchRbacMetadata())` for an
authenticated user. If `hasPersistedUser()` is true, it tries a cookie refresh first. This is the
state after a page reload with no in-memory token.

A failed `fetchPermissions()` resolves and does not reject, because the callers chain
`fetchRbacMetadata()` on it. The failure is not silent. The app reports it through
`NotifyService.error(err, 'errors.general.permissionsUnavailable')`. This report is necessary because
the ability stays `null`. Each `permissionGuard` then goes to `/forbidden`, which looks the same as a
true denial.

The fallback key is a root key and not a key of the `features/auth` scope. `fetchPermissions()` also
runs from the app initializer and from `features/admin`, where that scope is not loaded.

`fetchRbacMetadata()` has a permission gate. The server requires `permissions:read` on
`GET /rbac/metadata`. Thus the method resolves and makes no request when
`hasPermissions({ action: 'read', subject: 'Permission' })` is false. Callers must load the
permissions first. When the user has the permission, the method uses stale-while-revalidate. It
returns immediately if `RbacMetadataStore` holds the data. Then it refreshes the data in the
background.

#### UsersStore

`UsersStore` is a route-level store at `/users`. It uses `withEntities<User>()`.

Its state holds `filters: UserSearch`. An empty filter shows all users. A filled filter starts a
search through `GET /users/search/cursor`.

The store has one `load()` and `loadMore()` pair with **infinite scroll**. The page size is 20.
`upsertEntities` appends each page. The `hasMore` computed signal controls the sentinel. The
`isLoadingMore` signal shows the spinner.

`setFilters()` and `setSorting()` change the state. The component calls `load()` after each change.

The search field of the list has a limit of 255 characters (`MAX_USER_FILTER_LENGTH`). The search
endpoint answers a longer filter with a 400. Thus the form blocks the submit instead.

#### RbacMetadataStore

`RbacMetadataStore` uses `providedIn: 'root'`. It caches the resources and actions metadata in
`localStorage` with stale-while-revalidate.

The store reads the cached payload back through the `isCachedRbacMetadata` guard in
`store/storage-guards.ts`. The guard includes the elements, because `subjectMap` reads `name` and
`subject` from each resource. If a payload fails the guard, the store discards it. The catalog then
does a new read.

`AuthService.fetchRbacMetadata()` loads the store at bootstrap. This occurs only for a user with
`permissions:read`, because the server gates the endpoint in the same way.

`clear()` runs on logout. Thus the role and permission structure of the previous user does not stay
on a shared device.

Computed signal: `subjectMap` maps a resource name to a CASL subject.

#### Other services

- **ThemeService** has the `theme` signal with the value `'light'` or `'dark'`. It detects the
  system preference and writes the value to `localStorage`. If the persisted value is not one of the
  two modes, the service ignores it and does not apply it to `data-theme`.
- **LocalStorageService** and **SessionStorageService** are thin wrappers on the shared
  `web-storage.ts` helper. The helper owns the parse and serialize rules. It writes a string without
  quotation marks, thus a plain value stays readable outside Angular. For example, `main.ts` reads
  the language preference before the bootstrap. `getItem` accepts an optional type guard. If a value
  fails the guard, the method returns `null` and does not cast the value.
- **LanguageService** has the `lang` signal with the value `'en'` or `'ru'`. It reads
  `localStorage` first, then `navigator.language`, and then uses `'en'` as the fallback.
  `setLanguage()` changes the active Transloco language, registers the Angular locale data, and sets
  `document.documentElement.lang`. A factory supplies `LOCALE_ID` from this service.
- **DisplayPreferencesService** has the `density` signal with a level of `0` to `5`. The default
  level is `0`. The service writes the level to `localStorage` with the key `display-density`. An
  `effect` applies it as the `data-ui-density` attribute on `<html>`. `provideAppInitializer` makes
  the service at bootstrap, thus the saved value applies before the first paint. The Profile page
  shows this preference as the "Interface density" slider. This preference controls the compactness
  of the layout only. The browser zoom controls the full size.

#### NotificationsService

`NotificationsService` uses `providedIn: 'root'`. It is the SSE client. It uses `HttpClient` with
`observe: 'events'`, thus the JWT interceptor attaches the `Authorization: Bearer` header
automatically. The service parses `HttpDownloadProgressEvent.partialText` and keeps the offset.

The service supplies three streams:

- `sessionInvalidated$` calls `tokenService.forceLogout()`.
- `permissionsUpdated$` starts `authService.fetchPermissions()`, and then the permission-gated
  `fetchRbacMetadata()`.
- `userCrudEvents$` refreshes the user list. The server sends these events only to a client whose
  ability permits `users:search`.

`connect()` runs after a login and after a session restore. `disconnect()` runs on each session
teardown. This includes an explicit logout and a forced logout.

The retry uses exponential backoff. It starts at 3 s and has a limit of 60 s. It makes a maximum of
10 retries and uses `resetOnSuccess`. If the retries end, or if the server closes the stream, the
service connects again while the user stays authenticated. The server sends a heartbeat every 30 s
as an empty `data:` frame. The heartbeat prevents an idle timeout in a proxy.

The service recycles the connection each 4 h to 8 h. The interval has jitter for each client, thus
the clients do not reconnect at the same time. The recycle is a `disconnect()` and then a
`connect()`, which discards the buffers. This is necessary because an Angular HTTP backend keeps the
full response body for the full life of a request. The body includes each raw chunk and the
cumulative `partialText`. Thus a stream with no end increases the memory without a limit. The service
does not recycle while it is disconnected or while the user is not authenticated.

#### NotifyService

`NotifyService` uses `providedIn: 'root'`. It is the central helper for `MatSnackBar`.

Methods: `success(messageKey, params?)`, `info(messageKey, params?)`, `warn(messageKey, params?)`,
`error(messageKey, params?)` and `error(httpError, fallbackKey?)`.

The service translates the message with `TranslocoService`. It uses the translated `common.close`
action. It takes the duration and the position from `MAT_SNACK_BAR_DEFAULT_OPTIONS`. Thus a call site
does not repeat the configuration.

**A call site inside a feature must know that its scope is loaded.** The service translates at once,
and a feature translation file is a lazily fetched scope. A call from `ngOnInit` therefore can run
before the file lands, and `translate()` then answers with the key, which puts a raw dot-path on the
screen. A template gets the scope through `*transloco="let t; scope: '<name>'"`, but that directive
runs after `ngOnInit`. An init-time notification must wait for the scope first, as
`ProfileComponent.ngOnInit` does with `TranslocoService.load('auth/<lang>')`. A scope that is already
in the cache emits at once, so the wait costs nothing on the ordinary load.
`e2e/auth/profile-init-toast-i18n.spec.ts` holds that behaviour: it delays the scope file and asserts
that the key never reaches the screen.

The `HttpErrorResponse` overload uses the same parse sequence as `errorInterceptor`. It uses the
translated `errorKey` first. If no translation exists, it uses the server `message`. If that is
absent, it uses the translated `fallbackKey`. If that is also absent, it shows the status code.

**The app never shows a server `errorKey` outside this funnel.** An `errorKey` is a translation key
only when a translation for it exists. A direct translation puts a raw dot-path on the screen the
first time the server sends a key before the client i18n file has it. This occurred three times in
`features/auth`.

A `no-restricted-syntax` selector in `eslint.config.mjs` bans each form of `translate(errorKey)`. It
also bans an `errorKey` as a `NotifyService` message key. `http-error.utils.ts` holds the single
`eslint-disable-next-line` for the funnel itself. This is permitted, because the funnel compares the
result with the key and continues when no translation was found.

A client-owned fallback key has the name `fallbackKey` and never the name `errorKey`. Thus the word
has exactly one meaning.

### HTTP Interceptors

1. **errorInterceptor** catches the errors and shows a snackbar through
   `NotifyService.error(httpErrorResponse)`. It ignores a 401. `NotifyService` does the parse
   sequence of `errorKey`, then `message`, then the status. On the first 403, the interceptor reads
   `GET /auth/permissions` silently. Then it calls `AuthStore.setRules()`, which starts
   `RequirePermissionsDirective` through `effect()`, and `AuthStore.setMfaMandatory()` with the
   policy the same answer carries. Then it retries the original request one time.
   The `RBAC_RETRY_CONTEXT` token prevents a retry loop. The interceptor handles a failed permissions
   read and a failed retry separately, and shows the applicable error.
2. **jwtInterceptor** attaches the `Authorization: Bearer` header to a same-origin request only. A
   relative URL resolves against the origin of the app. An absolute cross-origin URL never gets the
   token, and its 401 does not start the refresh path. The interceptor handles a 401 with a token
   refresh and a retry of the request. It uses `shareReplay(1)`, thus two refreshes cannot run
   together.

### Path Aliases

| Alias | Path |
|-------|------|
| `@core/*` | `src/app/core/*` |
| `@features/*` | `src/app/features/*` |
| `@shared/*` | `src/app/shared/*` |
| `@environments/*` | `src/environments/*` |
| `@app/shared/*` | `../shared/src/*` (the shared types and constants of all 3 workspaces) |

## Feature flags: use of the client primitives

On the server, a flag is an entity with optional rules. A rule has the type user, role, percentage or
attribute. A rule includes or excludes.

A client sees the **evaluated booleans** only. It never sees the raw rules. The rule set is
administrator-only configuration, and it can show the segmentation strategy.

The client core is in `src/app/features/feature-flags/`.

| Piece | Use it for |
|-------|------------|
| `FeatureFlagsStore` (`providedIn: 'root'`) | To read the evaluated flag map from any place. `flags()` gives a `Record<string, boolean>`. `loaded()` gives a `boolean`. `isEnabled(key)` gives a `Signal<boolean>`. Each key has one memoized computed signal, which all consumers of that key share |
| `featureFlagGuard(key, redirectTo?)` | To gate a route: `canActivate: [featureFlagGuard('new-dashboard')]`. The guard runs `ensureAuthenticated()` first, and then `isEnabled(key)`. On a miss it goes to `redirectTo`. The default is `/forbidden` |
| `HasFeatureDirective`, that is `*nxsHasFeature` | To gate a template. The optional `nxsHasFeatureElse` input takes a fallback `<ng-template>`. The directive reacts to a store update through `effect()` |
| `FeatureEnabledPipe`, that is `\| featureEnabled` | To gate an attribute binding. The pipe sets `pure: false`, because the value comes from the store signal and not from the pipe argument. The cost is one property read for each check cycle |

### Typical patterns

To gate a route, put a flag on an admin page that loads on demand:

```ts
// app.routes.ts
{
  path: 'new-dashboard',
  loadComponent: () => import('./features/dashboard/new-dashboard.component')
    .then((c) => c.NewDashboardComponent),
  canActivate: [featureFlagGuard('new-dashboard')]
}
```

To gate a template, add a "coming soon" placeholder:

```html
<ng-template #placeholder>
  <p class="muted">{{ t('common.comingSoon') }}</p>
</ng-template>

<nxs-new-dashboard *nxsHasFeature="'new-dashboard'; else placeholder" />
```

To gate an attribute binding, disable an action while the flag is off:

```html
<button matButton="filled"
  [disabled]="!('beta-export' | featureEnabled)"
  (click)="exportToCSV()">
  {{ t('reports.exportButton') }}
</button>
```

### Lifecycle

`FeatureFlagsStore.load()` runs at bootstrap through `provideAppInitializer`. It runs for an
authenticated caller, together with `fetchPermissions()` and `fetchRbacMetadata()`. It also runs for
an anonymous visitor. For an anonymous visitor the load does not block, thus a public flag can gate a
placeholder in the first paint. On logout the app calls `clear()` on the store.

The flags stay live. `NotificationsService.featureFlagsUpdated$` is a filter on the SSE stream. It
starts `featureFlagsStore.reload()` each time the server sends `{ type: 'feature_flags_updated' }`.
The computed signal of each key sends the new value to its consumers. Thus `*nxsHasFeature` and
`featureEnabled` show the new value with no page reload.

A role change is a special condition. `permissionsUpdated$` also calls `reload()`, because a
role-bound rule can change for that user when their roles change.

### Admin

`/admin/feature-flags` is the management UI. It uses `permissionGuard('manage', 'FeatureFlag')`. It
is the fifth tab of `AdminPanelComponent`. Its components are in
`features/admin/components/feature-flags/`.

**`FeatureFlagListComponent`** shows a `mat-table` on a desktop. On a handset it shows a `mat-card`
list with a `mat-fab` at the bottom. `LayoutService.isHandset()` selects the layout. Each row has a
toggle, an edit action and a delete action.

If a flag has no include-effect rules, a change of the toggle to **on** first asks for a
confirmation. Such a flag evaluates to `true` for each authenticated user, because the shared
evaluator defaults to on when there is no include rule. A change to off does not ask. A flag that
already targets a subset also does not ask.

**`FeatureFlagFormDialogComponent`** has a top form and an embedded rules editor. The top form holds
the key, the description, the environments, the enabled state and the public state.

The environments chip grid gives options only and permits no free text. It gives exactly the
`APP_ENVIRONMENTS` names that the API accepts. Thus a user cannot type an invented name and get a 400
at save time.

The dialog opens at `DialogSize.Wide` on a desktop. On a handset it uses the
`.app-dialog-fullscreen-mobile` panel class from `_dialogs.scss`. That class gives an edge-to-edge
layout of `100vw` by `100dvh`, with a sticky title and sticky actions.

The rule order at save time is the array order. The component makes `priority: i` from the rendered
index before it sends the data, because the server contract still requires `priority`.

The `public` field has helper text. The text says that the field controls **anonymous** visibility
only. A save of an enabled flag with no include rules asks for the same "enable for everyone"
confirmation as the toggle in the list.

**`FeatureFlagPreviewComponent`** is the expandable panel at the bottom of the dialog. It builds a
synthetic context, from structured fields or from raw JSON, and posts it to
`POST /admin/feature-flags/:id/preview`. The dialog also gives it a `draft` input, which holds the
rule drafts, the enabled switch and the environment chips that are on screen. The panel merges that
draft into the request in both modes, thus the server evaluates the unsaved editor state and not the
stored flag. The server validates a supplied rule set with the validator of the save path, so an
incomplete rule gets the same 400 that a save would give.

The panel shows the reason as a chip. The reason `excluded` and the reason `not-included` are
different. The first one says that an exclude rule matched, and the chip beside it gives that
rule. The second one says that include rules exist and that no rule matched the context.

**`FeatureFlagRuleRowComponent`** edits one rule. Each type has its own payload editor. A `user` rule
and a `role` rule use comma-separated IDs. A `percentage` rule uses a `mat-slider` with a numeric
input. An `attribute` rule uses a field, an op and a value, plus a conditional `customKey`. That box is an
autocomplete. The dialog reads the registered keys once through
`FeatureFlagsAdminService.getAttributeKeys()` and passes them to every row, thus a flag with three
rules makes one request. The dialog also blocks a save that names a key outside that set, because the
set is a runtime fact of the server and a wrong key is a 400 that lands after the flag itself was
written.

The state and the HTTP calls are in `features/admin/{store,services}`:

- **`FeatureFlagsAdminStore`** is a route-level `signalStore` with
  `withEntities<FeatureFlagResponse>`. It has the same structure as `RolesStore`. `load()` uses
  `rxMethod`. Each CRUD method returns an `Observable`, thus a caller can show its own notification.
- **`FeatureFlagsAdminService`** is the HTTP wrapper for `/api/v1/admin/feature-flags/*`. `update()`
  sets `If-Match: <expectedVersion>` for optimistic locking. If the version is stale, the server
  answers HTTP 409 with `errors.featureFlags.versionConflict`.

## Styling

- **Angular Material** and the Angular CDK supply the UI components.
- The **SCSS architecture** has themes, utilities and component styles.
- The **light and dark themes** use the Material M3 system tokens (`--mat-sys-*`) and the semantic
  tokens of the app (`--app-*` for success, info, warning, text-tertiary and color-scheme).
- **Stylelint** applies the recess property order. A `unit-disallowed-list` rule rejects a `px` unit.
  A breakpoint media feature is the exception.

```
src/styles/
├── abstracts/        # Variables, functions, mixins
├── base/             # Reset, typography, animations
├── themes/           # Light and dark Material themes, plus the CSS variables
├── layout/           # Containers, grids
├── components/       # Cards, forms, loading, tables.
│                     # _dialogs.scss holds the global dialog overrides.
│                     # _buttons.scss holds .app-btn-danger, the destructive utility, and
│                     # .app-btn-loading, the spinner and label row of the loading branch of a
│                     # button.
│                     # _chips.scss holds .app-chip-danger, the destructive utility.
└── utilities/        # Flex, spacing, text and visibility helpers
```

Each size value uses `func.rem(N)`, which converts pixels to rem. Never write a `px` or `rem` literal.
Stylelint applies this rule with `unit-disallowed-list`. There are three narrow exceptions: the
`rem()` helper itself, the `$breakpoint-*` definitions, and the `env(safe-area-inset-bottom, 0px)`
fallback. A breakpoint stays in `px`, because a browser and Angular Material evaluate a media query
in `px`.

The global dialog styles are in `_dialogs.scss`. That file holds the title padding, the `::before`
reset and the correction for bug #26352. It also holds two panel classes that a dialog can select.
`.app-dialog-fullscreen-mobile` gives an edge-to-edge dialog on a handset. `.app-dialog-tall`
increases the `max-height` of the content from 65vh to 80vh.

The `DialogSize` enum and `dialogSizeConfig()` in `shared/utils/dialog.utils.ts` control the dialog
sizes.

**Spacing tokens.** `_variables.scss` supplies a primitive scale
(`$spacing-xxs/xs/sm/md/lg/xl/xxl`) and a semantic layer above it (`$space-component-gap`,
`$space-form-row-gap`, `$space-section-gap`). The mixins and the shared component styles use the
semantic tokens. Thus you can tune the scale in one place. The primitives stay available for a
non-semantic value.

**Runtime density.** `themes/_density.scss` makes the `[data-ui-density="1..5"]` classes in advance.
Each class contains `@include mat.all-component-densities(-N)`. Thus you can change the compactness
of the layout at run time. `DisplayPreferencesService` sets the attribute on `<html>` from the
"Interface density" preference of the user. Without these classes, the Material density is a
build-time mixin only.

**M3 color API.** The project uses an M3 theme through `@include mat.theme(...)`. The M2 attribute
`color="primary|accent|warn"` does nothing. `lint:no-mat-color`
(`client/scripts/lint-no-mat-color.mjs`) bans it, thus CI fails if a person adds it again.

For a destructive action, apply `class="app-btn-danger"` to a `matButton` or a `matIconButton`. For a
`<mat-chip>`, apply `class="app-chip-danger"`. The two classes use tokens (`var(--mat-sys-error)` and
`var(--mat-sys-error-container)`). Thus they obey the light theme and the dark theme automatically.

**Accessibility (WCAG 2.1 AA).** `app.component.html` shows a skip link at the top. The link uses the
`common.skipToContent` translation and points to `id="main"` on `<main role="main">`. This satisfies
WCAG 2.4.1 *Bypass Blocks*. Each navigation link in the sidenav has an `aria-label` and an
`aria-current`. The sidenav toggle has an `aria-label` and an `aria-expanded`. Each decorative
`mat-icon` has `aria-hidden="true"`. Each `aria-label` of a toolbar control binds to a Transloco
string.

## Testing

### Unit Tests (Vitest)

- Builder: `@angular/build:unit-test`
- Environment: jsdom
- Setup file: `src/test-setup.ts`, which holds the matchMedia polyfill
- Pattern: a `*.spec.ts` file stays beside its source file

**Runner configuration.** `vitest-base.config.mjs` holds the Vitest options that the builder does not
give. The `test` target refers to it through the `runnerConfig` option.

The file sets `testTimeout: 15000`. A TestBed spec pays the JIT compile cost of its component in its
first test. The slowest specs measure 2.9 s to 3.6 s on an idle machine. They measure 4.0 s to 6.2 s
when the workers compete for the CPU. Thus the Vitest default of 5000 ms failed each slow file that
lost the CPU race, and passed the same file on the next run. Vitest itself uses 15000 in browser
mode. `src/vitest-runner-config.spec.ts` asserts the increased value, thus the wiring cannot regress
silently.

**Test mocks.** A partial mock uses the type of the real object, or a scoped `// @ts-expect-error`. A
`no-restricted-syntax` ESLint rule bans an `as unknown as T` double cast. The selector is appended to
the array in `eslint.config.mjs`, because a flat configuration replaces the rule options and does not
merge them.

```bash
npm test
```

### E2E Tests (Playwright)

- Browser: Chromium
- **API testing.** The tests use the in-memory Express mock-server with isolation for each worker.
  They do not intercept the routes.

A worker-scoped fixture starts Express on a dynamic port through `listenOnUnblockedPort()`
(`mock-server/src/utils/listen.ts`). A test-scoped fixture resets the state.

The helper binds again when the OS gives a port on the WHATWG bad-port list. That list holds 6665 to
6669, 6679, 6697, 10080 and other values. The `fetch` function of Node refuses such a port with the
message `bad port`. Chromium refuses it with `ERR_UNSAFE_PORT`. Thus a worker with such a port failed each
request with an error that named no port.

`page.route(/\/api\//)` intercepts an API call and rewrites the URL to the mock-server port of the
worker.

**CI web server.** CI runs `ng build` before `playwright test`. Then it serves the built output with
`serve -s dist/client/browser`. This removes the 60 s to 90 s start time of the Angular dev server.
Local development continues to use `ng serve`.

Seed data: 5 well-known users and 65 users from faker, thus 70 users in total. The credentials are
`admin@example.com / Password1` for the administrator and `user@example.com / Password1` for the
user.

Each seed id is a UUID. This agrees with the `ParseUUIDPipe` that the server puts on each id path
parameter. To address a seed row, use `mockId('user-1')` (`e2e/fixtures/ids.ts`) and not a literal
id. The mock answers a malformed id with a 400, and the server does the same.

The fixtures in `e2e/fixtures/` are modular:

- `base.fixture.ts` holds the `_mockServer` (MockServerApi) fixture and the `_workerMockServer`
  fixture. It also re-exports each other module.
- `jwt.utils.ts` holds the JWT utilities: `base64url`, `createMockJwt`, `createExpiredJwt` and
  `createValidJwt`.
- `mock-data.ts` holds the `MockUser` type, `defaultUser`, and the re-exported factories
  `createMockUser` and `createOAuthAccount`.
- `helpers.ts` holds `loginViaUi()`, `loginViaUiKeepSse()`, `expectAuthRedirect()`,
  `expectForbiddenRedirect()`, `openedDialog()` and `routeApiToMockServer()`.
  `loginViaUiKeepSse()` does not wait for `networkidle`, thus a test can keep a true SSE stream open.
  `base.fixture` applies the `/api` redirect and the SSE stub to the fixture page. A Playwright route
  applies to one page, thus a test that opens a second tab must apply `routeApiToMockServer()` to
  that tab.

**Wait for a dialog with `openedDialog(page)` before each keyboard operation.** Do not use
`expect(getByRole('dialog')).toBeVisible()`. A dialog becomes visible approximately 150 ms before it
is safe to type into it. `MatDialog` starts its focus trap at the end of the open animation, and then
focuses the first tabbable element. The Playwright `fill()` method is two round trips: an in-page
`select()` and `focus()`, and then a separate `Input.insertText` to the element that holds the focus.
If the trap starts between the two trips, the text goes to the first field. The intended field then
stays empty and shows a required error. Measurement on the Add Action dialog: 3 of 98 fills were
incorrect without the wait, and 0 of 98 were incorrect with it.

Test structure: the tests are in one directory for each module, that is `e2e/auth/`, `e2e/users/` and
`e2e/admin/`.

**Accessibility.** `e2e/a11y.spec.ts` runs `@axe-core/playwright` (WCAG 2.1 AA) against each major
route. `e2e/keyboard-nav.spec.ts` verifies the keyboard-only flows: login, sidenav, user edit and the
focus trap of a dialog. The a11y file sets its own `timeout: 60_000` through
`test.describe.configure`. An axe scan is CPU-bound and competes with the other three workers. The
same scan takes approximately 9 s with one worker, and 21 s to 30 s in a full parallel run. The users
list is the heaviest page, and it repeatedly came near to the default limit of 30 s.

**Live RBAC and authentication regression net.** The suite holds these specs:

- refresh-token reuse detection (`refresh-token-reuse.spec.ts`)
- role revocation through SSE hides the admin link (`role-revocation-via-sse.spec.ts`)
- an administrator on `/admin` goes to `/forbidden` (`admin/admin-panel-permission-loss.spec.ts`)
- a reactive 401 causes a refresh and a retry (`reactive-token-refresh.spec.ts`)
- logout and then the browser Back button (`logout-back-button.spec.ts`)
- a logout in one tab ends the session in a second tab of the same context
  (`cross-tab-logout.spec.ts`). The observing tab stays on `/profile`. A list page continues to send
  cursor requests, and the jwt interceptor sends the first 401 to `/login` with or without the
  listener.
- OAuth safety for the last provider (`oauth-unlink-last-provider.spec.ts`)
- a wire-contract assertion that `auth_user.roles` is a `RoleResponse[]`
  (`post-login-admin-badge.spec.ts`)
- an OAuth sign-in completes the session, thus a guarded return URL activates and does not go to
  `/forbidden` (`oauth-callback-session.spec.ts`)
- a feature-flag toggle propagates through SSE (`admin/feature-flags.spec.ts`)

**Design-token regression net.** `e2e/visual/m3-colors.spec.ts` asserts that each destructive utility
resolves to `--mat-sys-error`. `e2e/visual/sidenav-width.spec.ts` asserts that the drawer, the rail
and the content offset resolve to the `--nav-width-*` custom properties. An undeclared token collapses
the layout silently.

**Coverage.** The suite has 240 Playwright tests. They cover auth, users, admin, billing, a11y,
keyboard and visual. There are also 1238 Vitest unit tests. They cover login, register and profile.
The profile tests include the self-service email change, which shares one submit with the name edit
and the password edit. An account created through a provider holds no password, so the profile page
shows a notice naming that provider in place of the current-password field, and both the email change
and the first password leave for the provider and resume when the callback returns with `?reauth=ok`.
The email change carries its pending address across the round trip; the first password carries only a
marker, because a credential must not sit in web storage, so the page asks for the password again on
return. Six Playwright tests cover the two paths, with the proof seeded through
`POST /__control/reauth-proof`, because both provider halves of the mock stay 501 stubs. The unit tests also cover session restore, cross-tab logout, lockout, email
verification, and password reset with a password confirmation. They cover the users list, detail, edit
and search. This includes the email-change confirmation dialog of the administrator and the
soft-delete and restore flow. They also cover the administration of roles, resources and feature
flags, the effective-permissions preview, and the automatic redirect of the admin panel when the
session loses its permissions. The a11y audit and the keyboard navigation have tests. The error
translation tests verify the `errorKey` to Transloco sequence for login, for register and for the
snackbar of the global interceptor.

- Workers: 4. They run fully in parallel, and each worker has its own mock-server instance on a
  dynamic port.
- Web server start: `webServer.timeout` is 180 s. Playwright starts `ng serve` locally. The first
  build with an empty `.angular/cache` can take much more than the Playwright default of 60 s on a
  slow or loaded machine. CI serves the built `dist/` and starts in seconds, thus the additional
  time has no effect there.

```bash
npm run test:e2e           # Headless
npm run test:e2e:ui        # Interactive UI
```

## Docker

The `Dockerfile` has 2 stages for a production build:

1. The **builder** stage installs the dependencies with `npm ci --ignore-scripts`. Then it builds
   Angular with `NODE_OPTIONS="--max-old-space-size=2048" npm run build -- --base-href $BASE_HREF`.
   The `BASE_HREF` ARG defaults to `/nexus/`. To change it, use
   `docker build --build-arg BASE_HREF=/`.
2. The **runner** stage copies the built assets to nginx:1.27-alpine with `client/nginx.conf`. That
   configuration enables gzip and supports HTML5 pushState through `try_files`. It sets
   `Cache-Control: public, max-age=31536000, immutable` for a content-hashed bundle, and
   `Cache-Control: no-cache` for `index.html`.

The server supplies the Angular app from the `/nexus/` base href. Each internal API URL must be an
absolute path that starts with `/`, for example `/api/v1/users`. Thus the URL resolves to the server
root and not to `/nexus/api/v1/users`.

To run the full stack, use `docker-compose.yml` in the root of the repository.

---

## Versioning

`scripts/version.mjs` makes the version string at build time, at start time and at test time. The
script does three steps:

1. It reads `version` from `client/package.json`.
2. It gets the short git hash with `git rev-parse --short HEAD`.
3. It writes `src/environments/version.ts`, which is in `.gitignore`:

```typescript
export const APP_VERSION = '0.1.0';
export const BUILD_HASH = 'abc1234';
```

`HeaderComponent` imports these values. It shows them as a `MatTooltip` on the application name in
the toolbar. The name comes from `environment.appName`.

To make a new release, run these commands in `client/`:

```bash
npm run release    # bumps client + server + mock-server package.json, writes repo CHANGELOG.md, tags commit
git push --follow-tags
```

Each commit must obey [Conventional Commits](https://www.conventionalcommits.org/). The `commit-msg`
husky hook applies this rule.

The same hook rejects a bare `@name` in a message. Such a name goes to `CHANGELOG.md` and to the
release page as a GitHub user mention, and gives credit to an unrelated account. Thus a code
identifier must have backticks, for example `` `@Authorize` ``. `scripts/at-mentions.mjs` escapes a
name that gets past the hook. It does this during the changelog generation, and again in
`npm run release:publish`.

## Tech Stack

| Technology | Version |
|------------|---------|
| Angular | 21.2.21 |
| Angular Material | 21.2.14 |
| TypeScript | 5.9.3 |
| @ngrx/signals | 21.1.1 |
| @jsverse/transloco | 8.4.0 |
| RxJS | 7.8.2 |
| Vitest | 4.1.11 |
| Playwright | 1.62.1 |
| ESLint | 9.39.5 |
| Prettier | 3.9.6 |
| Stylelint | 17.14.1 |
| commitlint | 20.5.3 |
| commit-and-tag-version | 12.7.3 |
