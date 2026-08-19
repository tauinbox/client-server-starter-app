# Fullstack Starter App

Full-stack TypeScript monorepo with **Angular 21** client and **NestJS 11** server, using PostgreSQL via TypeORM. Provides a production-ready foundation with authentication, user management, and theming.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | Angular | 21.2.19 |
| UI Library | Angular Material + CDK | 21.2.14 |
| Backend | NestJS | 11.1.17 |
| Database | PostgreSQL (TypeORM) | 0.3.28 |
| Language | TypeScript | 5.9.3 |
| Auth | JWT + HttpOnly-cookie refresh tokens + OAuth (Passport) | - |
| Client Tests | Vitest (unit), Playwright (e2e) | 4.0.18 / 1.61.0 |
| Server Tests | Jest (unit + e2e) | 30.2.0 |

## Features

### Authentication
- Email/password registration and login
- **Account lockout** — 5 consecutive failed login attempts lock the account for 15 minutes (HTTP 423 with countdown); admin can unlock early via user-edit page
- **Email verification** — new registrations require email verification before login (HTTP 403); resend-verification endpoint; OAuth users marked verified only when the provider asserts `email_verified=true` for that same address (Google/Facebook), on account creation and on every later login alike; otherwise a verification email is sent and the flag stays false until the link is opened. Admin email changes via `PATCH /api/v1/users/:id` reset `isEmailVerified` to false, issue a new hashed verification token, and dispatch a fresh verification email; uniqueness is enforced server-side (HTTP 409 with `errorKey: errors.users.emailExists` and `field: 'email'`)
- **Self-service email change** — users can change their own email from `/profile` via a two-step confirm-to-new flow: `POST /api/v1/auth/profile/email/initiate` (authenticated, throttled 3/hour, requires current password and rejects OAuth-only accounts) stores a hashed 1-hour token on the user row and sends a confirmation link to the new address + a no-link alert to the old address with the new address masked; `POST /api/v1/auth/profile/email/confirm` applies the change inside a transaction, re-checks uniqueness for the race window, revokes all refresh tokens, and notifies the old address. A partial unique index on `LOWER(pending_email)` and dual-email checks in `register` / `users.update` / `users.create` keep the `{email} ∪ {pendingEmail}` set globally unique. The new endpoints are mirrored in `mock-server/` with the same response shapes and enumeration-safe behaviour.
- **Password reset** — forgot-password sends a reset link (30-minute token expiry); reset invalidates all active sessions
- **CAPTCHA soft-trigger on register / forgot-password** — Cloudflare Turnstile challenge activated server-side only when `X-RateLimit-Remaining ≤ 1` for the caller's IP, so legitimate users normally do not see it. **Disabled by default** — production activation requires a free Cloudflare account (the included test keys provide zero abuse protection in prod and are intended for local dev / CI only). Step-by-step deploy flow in [`server/README.md` → "Enabling CAPTCHA in production"](server/README.md#enabling-captcha-in-production). Client fetches the public site key from `GET /api/v1/auth/captcha-config` and lazy-loads the Turnstile script only when needed
- **OAuth2 login via Google, Facebook, VK** — never auto-links to a pre-existing local account (account-takeover prevention); users must log in with their password and link the provider explicitly from their profile. Creates OAuth-only users for emails not yet registered. Any failed callback — an expired state cookie, a failed code exchange — returns the browser to `/login?oauth_error=auth_failed` instead of leaving it on an API error page. A declined consent screen is told apart from a genuine failure (`oauth_error=oauth_cancelled`, its own message), and a cancelled or failed **link** attempt returns to `/profile`, where it started, instead of dropping an already logged-in user on the login page
- **Provider buttons are auto-gated by configuration** — each provider is exposed as a public feature flag (`oauth-google` / `oauth-facebook` / `oauth-vk`) carrying an attribute rule on a server-registered, env-derived signal (`oauth<Provider>Configured`, true when `*_CLIENT_ID` is set). A button shows only when the provider is configured **and** its flag is enabled (the manual override); the login page hides the whole OAuth block when none qualify, and the profile "connected accounts" card hides providers that are neither configured nor already linked. Admins toggle the flags from `/admin/feature-flags`
- JWT access tokens (1h, stored in-memory only) + opaque refresh tokens (7d, stored as HttpOnly `SameSite=Strict` cookie — never readable by JavaScript)
- Session restored on page reload via cookie-refresh in `provideAppInitializer` before route guards run
- Automatic token refresh 60 seconds before expiry; a response that lands after the session was torn down is discarded instead of restoring it
- 401 handling with request retry in JWT interceptor
- **Reactive permission refresh on 403** — `errorInterceptor` detects mid-session 403s, silently re-fetches `/api/v1/auth/permissions`, updates `AuthStore.ability`, and retries the request; `RequirePermissionsDirective` reacts via Angular `effect()` without a page reload
- **Real-time notifications via SSE** — `GET /api/v1/notifications/stream` (JWT-protected) pushes three event types: `session_invalidated` (force-logout on admin password change or user delete), `permissions_updated` (silent permissions re-fetch when a user's roles change or when a role they hold has its permission set changed — fanned out to every connected holder of that role), `user_crud_events` (admin user list auto-refresh on create/update/delete/restore — delivered only to connected clients whose current abilities allow `users:search`, so ordinary users never see them). Client uses `HttpClient` with `observe: 'events'` so the existing JWT interceptor attaches the Bearer token; `NotificationsService` connects on login and disconnects on logout with exponential-backoff reconnect, and recycles the connection every 4–8 h (jittered) so the transport buffers Angular retains for the life of a request cannot grow unbounded on long-lived tabs
- **Role-Based Access Control (RBAC)** — dynamic resources and actions with `@RegisterResource` auto-discovery; `isSuper` flag on roles replaces hardcoded admin bypass; `@Authorize(['action', 'Subject'])` typed tuples on server; `permissionGuard(action, subject)` + `instancePermissionGuard(action, subject, instanceFactory)` + `*appRequirePermissions="{ action, subject, instance? }"` directive on client; `/api/v1/rbac/` endpoints for managing resources and actions. `PermissionsGuard` attaches the built `AppAbility` to the request for downstream instance-level checks via `@CurrentAbility()`. Valid CASL subject names are auto-generated from `@RegisterResource` decorators into `shared/src/generated/casl-subjects.ts`
- `GET /api/v1/auth/permissions` returns CASL packed rules; client hydrates into `AppAbility` at bootstrap before route activation
- OAuth account management (link/unlink providers in profile)
- Server-side token cleanup via cron jobs
- **Audit logging** — security-sensitive operations recorded to `audit_logs` table (login, registration, password changes, user/role management, OAuth events); nightly cleanup removes entries older than `AUDIT_LOG_RETENTION_DAYS` days (default 90)
- **Feature flags** — dedicated subsystem for hiding in-development functionality and progressively rolling it out (specific users, roles, percentages, attributes, environments). `GET /api/v1/feature-flags` evaluates the flag set for the caller (authenticated → each flag they resolve true plus any `public` flag, with disabled non-public flags omitted; anonymous → only `public: true` flags). Admin CRUD at `/api/v1/admin/feature-flags` with optimistic locking via the `If-Match` header. Anonymous-user bucketing via the `nxs_anon_id` cookie (set automatically by `AnonIdMiddleware`) so a 10 % rollout of a public flag converges on the same 10 % of anonymous browsers across reloads. `FeatureFlagChangedListener` invalidates the cache on every change and coalesces the SSE broadcast of `{ type: 'feature_flags_updated' }` (a burst of changes triggers one synchronized client refetch, and the flag-list reload behind those refetches is single-flight); the per-user cache is keyed by a global version counter so changes orphan all per-user entries without needing Redis `SCAN MATCH` (Redis-backed deployments bump it with an atomic `INCR`, so simultaneous invalidations across instances cannot collapse into one version). A flag's `environments` are restricted to the names the server can actually run as and normalized on write, and an `attribute` rule's `value` must match a shape its operator can compare; both would otherwise store a rule that reads as active but can never match. The `AttributeRegistryService` is the extensibility seam — other modules call `registerAttribute('tenantId', resolver)` from `onModuleInit` to expose tenant / org / region / subscription-tier attributes to the evaluator. `@RequireFeature('key')` + `FeatureFlagGuard` is a convenience decorator for hiding routes entirely (returns HTTP 404 for anti-enumeration); RBAC remains the actual authorization gate. The Angular client mirrors the surface with `FeatureFlagsStore` (NgRx Signals, loaded at bootstrap on both authenticated and rehydration paths, plus a non-blocking load for anonymous visitors so public flags can gate landing-page previews), `featureFlagGuard(key, redirectTo?)` for route-level gating, `*nxsHasFeature="'key'"` structural directive with an optional `nxsHasFeatureElse` template, and `{{ 'key' | featureEnabled }}` pipe for attribute bindings; SSE-driven `reload()` propagates admin toggles to connected clients without a refresh, and `permissionsUpdated$` also triggers `reload()` so role-bound flags stay in sync after a role change

### Admin Panel
- **Role management** — tabbed `/admin` shell (`AdminPanelComponent`) with "Users", "Roles", and "Resources" tabs. Role list with create/edit/delete dialogs; `RolePermissionsDialogComponent` assigns permissions to roles with optional CASL conditions (ownership, fieldMatch, userAttr, custom)
- **Resource/Action management** — "Manage Resources" tab at `/admin/resources` (requires `read:Permission`). Resources table allows editing display name, description, and allowed actions per resource (`allowedActionNames`); Actions table supports create, edit, and delete of non-default actions. Each mutation refreshes `RbacMetadataStore` automatically
- **Billing console** — "Billing" tab at `/admin/billing` (requires `manage:Billing`, hidden behind the public `billing` flag). Read-only tables of every customer's subscriptions and invoices (desktop table / handset cards) with the two M1 mutations: cancel a subscription (end-of-period or immediate, via a confirm dialog; a subscription that is no longer open is refused with a conflict instead of being cancelled twice) and refund a paid invoice. Both lists are cursor-paginated behind an infinite scroll, each backed by its own store, so the page never reads a whole table. Fully internationalized (EN / RU)
- **CASL condition editors** — all four condition types supported in the permissions dialog: `ownership` checkbox, `fieldMatch` / `userAttr` JSON editors, and a `custom` visual condition builder with field/operator/value form, nested `$or`/`$and` groups, JSON preview, and raw JSON fallback toggle. The `ownership` / `fieldMatch` / `userAttr` editors validate the condition shape inline (shared `permission-condition-shape.ts` finders — the same rules the server DTO enforces), so a malformed condition (e.g. a `fieldMatch` value that is not a non-empty array) blocks save with a translated error instead of a 400 round-trip
- **Operator-safe `custom` conditions** — the `custom` branch runs `validateMongoQueryKeys()` on parsed user-supplied JSON before any merge, the same allow-list `PermissionConditionDto` applies on write: a `__proto__`/`constructor`/`prototype` key, any `$`-operator outside `ALLOWED_MONGO_OPERATORS` (`$where`, `$regex`, `$exists`, a typo), or a `$in`/`$nin` whose value is not an array of JSON scalars, vetoes the entire permission. Screening the runtime layer with the write layer's allow-list keeps a stored row from meaning one thing to CASL and another to the SQL list-filter translator, which cannot reproduce those operators — nor bind anything but a scalar into `IN (:...p)`, which is why the element rule `fieldMatch` has always enforced now applies to raw `custom` JSON too
- **Condition translation** — each branch of `PermissionCondition` (ownership, fieldMatch, userAttr, custom) is translated to a MongoQuery by `resolveConditions()` in `server/src/modules/auth/casl/resolve-conditions.ts`, merged in that fixed order (later writes win, except the protected `ownership.userField` key — a collision on it vetoes the permission). To add a new condition type, add a branch to `resolveConditions()` and extend `PermissionCondition` in `shared/src/types/role.types.ts`
- **Fail-closed condition resolution** — a condition that cannot be honored as authored vetoes the whole permission instead of degrading into a wider grant: a malformed branch shape (non-array / empty-array `fieldMatch` values, non-string `userAttr` attributes, empty or non-string `ownership.userField`, prototype-pollution keys, `$`-prefixed keys and attribute names), an unknown `userAttr` attribute, invalid/non-object `custom` JSON, a `custom` operator outside `ALLOWED_MONGO_OPERATORS`, or restriction branches that resolve to an empty query. Partial resolution is never registered — dropping just the malformed part would silently widen the intended restriction. A vetoed `deny` registers as an unconditional `cannot()` so a broken deny rule never silently disappears; only a branch-less condition object (bare `effect`) registers unconditionally
- **Identity-bound conditions are rejected on a `create` grant** - `ownership` and `userAttr` both resolve to the acting user's id, which a record that does not exist yet can never carry, so attaching either to a `create` permission denies every create instead of restricting it. `RoleService` rejects such a grant with 400 (`errors.roles.conditionNotApplicable`) on both permission-write routes (`PUT/POST /roles/:id/permissions`), for every caller including supers, and the mock server mirrors it. `fieldMatch` and `custom` stay usable on `create` - they are evaluated against the submitted payload by the instance-level check on `POST /users`
- **Condition shape validation at input** — `PermissionConditionDto` enforces the inner shape of `ownership` / `fieldMatch` / `userAttr` (shared finders in `shared/src/utils/permission-condition-shape.ts`, also used by the client editors and the mock server), so a partially malformed condition (e.g. `{"status": ["active"], "dept": "sales"}` — forgotten array brackets) is rejected with 400 at authoring time instead of silently registering a wider rule. A key starting with `$` is rejected the same way in all three branches: it would land in field position of the resolved MongoQuery and be read as an operator, making an allow grant nothing and a deny stop denying

### CASL Permission Conditions

The project uses [CASL](https://casl.js.org) (`@casl/ability` v6) with `MongoAbility` — a variant that evaluates conditions using **MongoDB query syntax** (operators like `$in`, `$lt`, `$or`, etc.). This is a pure in-memory evaluation engine (via `@ucast/mongo2js`, bundled inside CASL v6) — **no actual MongoDB database is involved**.

#### How Conditions Work

Each permission assigned to a role can optionally have a `conditions` object (stored as JSONB in `role_permissions.conditions`). When the server builds the CASL ability for a user, conditions are translated into MongoDB-style queries that CASL evaluates at runtime against entity instances.

```
Without conditions:     can('update', 'User')                         → allows updating ANY user
With conditions:        can('update', 'User', { id: currentUserId })  → allows updating ONLY own record
```

The client receives packed CASL rules via `GET /api/v1/auth/permissions`, unpacks them into `AppAbility`, and evaluates the same conditions locally — so UI elements (Edit/Delete buttons) hide/show consistently with what the server enforces.

#### Condition Types

Type definition (`shared/src/types/role.types.ts`):

```typescript
type PermissionCondition = {
  effect?: 'allow' | 'deny';                // default 'allow'
  ownership?: { userField: string };
  fieldMatch?: Record<string, unknown[]>;
  userAttr?: Record<string, unknown>;
  custom?: string;  // JSON-stringified MongoDB query
};
```

All four condition types can be combined on a single permission — they are merged into one query with implicit AND logic. The separate `effect` flag controls whether the resulting rule is a CASL `can()` (allow) or `cannot()` (deny) — see "Deny Rules" below.

---

**Type 1: `ownership`** — restrict access to records owned by the current user

Sets `query[userField] = userId` where `userId` is the authenticated user's ID.

| Admin UI | JSON stored |  Generated CASL rule |
|----------|-------------|---------------------|
| Checkbox + field name input (default: `"id"`) | `{ "ownership": { "userField": "id" } }` | `can('update', 'User', { id: '<userId>' })` |

Examples:

| Scenario | userField | Effect |
|----------|-----------|--------|
| User can edit own profile | `"id"` | `User.id` must match current user's ID |
| Author can edit own posts | `"authorId"` | `Post.authorId` must match |
| Manager sees own team | `"managerId"` | `Team.managerId` must match |

---

**Type 2: `fieldMatch`** — restrict access based on specific field values (allowlist)

Each field is translated to a `$in` operator: `query[field] = { $in: values }`.

| Admin UI | JSON stored | Generated CASL rule |
|----------|-------------|---------------------|
| JSON textarea | `{ "fieldMatch": { "status": ["active", "pending"] } }` | `can('read', 'Order', { status: { $in: ['active', 'pending'] } })` |

Examples:

| Scenario | Configuration | Effect |
|----------|--------------|--------|
| Support sees only active users | `{ "isActive": [true] }` | Can only read users where `isActive === true` |
| Editor manages draft/review posts | `{ "status": ["draft", "review"] }` | Cannot touch published posts |
| Regional manager | `{ "region": ["EU", "NA"] }` | Access limited to EU and NA records |

---

**Type 3: `userAttr`** — map a record field to a user attribute

Resolves the attribute name from a user context object: `query[field] = userContext[attrName]`.

| Admin UI | JSON stored | Generated CASL rule |
|----------|-------------|---------------------|
| JSON textarea | `{ "userAttr": { "createdBy": "id" } }` | `can('update', 'User', { createdBy: '<userId>' })` |

Currently available user context attributes: `{ id: userId }`. To add more (e.g., `departmentId`, `tenantId`), extend the `userContext` object in `CaslAbilityFactory.createForUser()`.

Difference from `ownership`: `ownership` always maps to `userId`. `userAttr` maps to any user attribute — once more attributes are added to userContext, this becomes the most flexible built-in type.

---

**Type 4: `custom`** — raw MongoDB query for complex conditions

The value is a **JSON string** (stringified MongoDB query). It is parsed and merged key-by-key into the condition query.

| Admin UI | JSON stored | Generated CASL rule |
|----------|-------------|---------------------|
| JSON textarea with validation | `{ "custom": "{\"price\":{\"$lt\":100}}" }` | `can('update', 'Product', { price: { $lt: 100 } })` |

**Supported MongoDB operators** — the only operators accepted in `custom` conditions. The set is deliberately limited to operators the server-side SQL list-filter can reproduce faithfully (see the note below), so a condition behaves the same whether it is checked against a single record or used to filter a list:

| Operator | Meaning | Example |
|----------|---------|---------|
| `$eq` | Equals | `{ "status": { "$eq": "active" } }` or `{ "status": "active" }` |
| `$ne` | Not equals | `{ "status": { "$ne": "archived" } }` |
| `$lt` | Less than | `{ "price": { "$lt": 100 } }` |
| `$lte` | Less than or equal | `{ "price": { "$lte": 100 } }` |
| `$gt` | Greater than | `{ "quantity": { "$gt": 0 } }` |
| `$gte` | Greater than or equal | `{ "rating": { "$gte": 4 } }` |
| `$in` | In array | `{ "status": { "$in": ["active", "pending"] } }` |
| `$nin` | Not in array | `{ "role": { "$nin": ["admin", "super"] } }` |

**Logical operators** (combine multiple conditions):

| Operator | Meaning | Example |
|----------|---------|---------|
| `$and` | All must match | `{ "$and": [{ "price": { "$lt": 100 } }, { "status": "active" }] }` |
| `$or` | Any must match | `{ "$or": [{ "status": "draft" }, { "status": "review" }] }` |
| `$nor` | None must match | `{ "$nor": [{ "status": "archived" }, { "status": "deleted" }] }` |
| `$not` | Negation | `{ "price": { "$not": { "$gt": 1000 } } }` |

Security: prototype pollution keys (`__proto__`, `constructor`, `prototype`) are silently skipped during parsing.

> **Server-side SQL translation (`apply-ability.util.ts`)** — when CASL conditions are translated into SQL `WHERE` fragments for the `GET /users` listing, the translator supports exactly the operators above (`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$and`, `$or`, `$nor`, `$not`) against the user fields `id`, `email`, `firstName`, `lastName`, `isActive`. Input validation rejects any other operator up front, so the accepted set and the translatable set are identical (a drift-guard test enforces this). Operands must be scalars on both sides: a comparison value and every element of a `$in`/`$nin` array are checked, since only a scalar can be bound into `IN (:...p)`. As defense-in-depth for pre-existing data, any rule using an unsupported operator or field, or a list holding a non-scalar element, is still **dropped entirely** (fail-closed) and a warning is logged. Run `npm run check:role-conditions` (in `server/`) against a staging dump to surface any existing rows that would be affected.
>
> `deny` rules are translated too: allow and deny groups are built separately and combined as `allow AND NOT deny`, so a deny narrows the listing exactly as it narrows a single-record check. An unconditional deny reduces the listing to no rows. The fail-closed rule is asymmetric — dropping an untranslatable allow only narrows the result, but dropping a deny would widen it, so an untranslatable deny reduces the whole query to no rows instead of being skipped.

#### Combining Multiple Condition Types

Multiple types on the same permission are merged into one query (AND):

```json
{
  "ownership": { "userField": "id" },
  "fieldMatch": { "isActive": [true] },
  "custom": "{\"email\":{\"$in\":[\"a@company.com\",\"b@company.com\"]}}"
}
```

Produces:
```
can('update', 'User', {
  id: '<userId>',                              // from ownership
  isActive: { $in: [true] },                   // from fieldMatch
  email: { $in: ['a@company.com', ...] }       // from custom
})
```

Meaning: user can update only their own record, only if it's active, and only if the email matches the company domain.

**Conflict resolution:** if the same field key appears in multiple condition types, later types overwrite earlier ones. Processing order: ownership → fieldMatch → userAttr → custom. Exception: the `ownership.userField` key is protected — a `fieldMatch`, `userAttr`, or `custom` entry on that key would replace the owner-scoping predicate with a broader one, so the whole permission is vetoed (fail closed) instead.

#### Practical Examples

| # | Scenario | Resource | Action | Condition | Result |
|---|----------|----------|--------|-----------|--------|
| 1 | User edits own profile | User | update | `{ "ownership": { "userField": "id" } }` | Edit button on own record only (default seed config) |
| 2 | Moderator deletes inactive users | User | delete | `{ "fieldMatch": { "isActive": [false] } }` | Delete button on inactive records only |
| 3 | Editor updates cheap products | Product | update | `{ "custom": "{\"price\":{\"$lt\":100}}" }` | Edit allowed only when `price < 100` |
| 4 | Support sees active EU/NA users | User | read | `{ "fieldMatch": { "isActive": [true] }, "custom": "{\"$or\":[{\"region\":\"EU\"},{\"region\":\"NA\"}]}" }` | Filtered to active users in EU or NA |
| 5 | Manager manages users they created | User | update | `{ "userAttr": { "createdBy": "id" } }` | Only records where `createdBy === managerId` |

#### Instance-Level Checks

**Server-side:** controllers inject `@CurrentAbility()` and pass it to the service, which loads the entity and calls `ability.can(action, entity)`. Returns 403 if denied. On `UsersService` the ability parameter is **required** (typed `AbilityOrSystem`), so a new caller cannot skip filtering or the instance check by omitting it — a caller that genuinely acts without a requesting principal (e.g. the self-service `PATCH /auth/profile`, whose target is pinned to the authenticated user) passes the explicit `SYSTEM_ABILITY` sentinel.

**Client-side** — three mechanisms:

1. **`*appRequirePermissions` directive** (templates) — evaluates per-row, supports an optional `else` template for rendering a fallback when access is denied (e.g. disabled button + tooltip instead of hiding it entirely):
   ```html
   <button
     *appRequirePermissions="
       { action: 'update', subject: 'User', instance: user };
       else denied
     "
     (click)="edit(user)"
   >Edit</button>
   <ng-template #denied>
     <span [matTooltip]="'You do not have permission to edit this user'">
       <button disabled>Edit</button>
     </span>
   </ng-template>
   ```

2. **`instancePermissionGuard`** (routes) — checks before route activation:
   ```typescript
   canActivate: [instancePermissionGuard('update', 'User', (route) => ({ id: route.params['id'] }))]
   ```

3. **Computed properties** (components with complex logic):
   ```typescript
   canManageUser = computed(() => {
     const u = this.user();
     if (!u) return false;
     return this.authStore.hasPermissions({
       action: 'update', subject: 'User', instance: { id: u.id }
     });
   });
   ```

#### Super Roles

Roles with `isSuper: true` receive `can('manage', 'all')` — a CASL wildcard that bypasses all condition checks. All buttons visible, all routes accessible, all API calls allowed.

This is the only path to a wildcard rule. `manage` and `all` are rejected as action names and `all` as a resource subject when they are written, and rejected again when rules are built: a stored permission carrying either keyword is skipped (and logged at `error`) if it is an allow, and kept if it is a deny, since inverting a wildcard only ever restricts. The mock server's rule packer applies the same guard.

#### Deny Rules (`effect: 'deny'`)

Any permission on a role can set `effect: 'deny'` in its `conditions` to register a CASL `cannot()` rule instead of a `can()` rule. The factory partitions rules allow-first, deny-last; CASL's last-matching-rule semantics mean a deny always overrides a prior allow for the same `(resource, action)` pair. Deny rules may carry the same MongoQuery conditions as allow rules (ownership / fieldMatch / userAttr / custom), so you can express patterns like:

- Blanket deny after allow: Role A has `update:User` (allow, no conditions); Role B has `update:User` with `{ effect: 'deny' }` → net: cannot update any user.
- Conditional deny: Role A has `update:User` with `{ ownership: { userField: 'createdBy' } }` (allow-own); Role B has `update:User` with `{ effect: 'deny', fieldMatch: { status: ['locked'] } }` → net: can update own records except when `status === 'locked'`.

Expose the flag in the admin UI via the "Deny" toggle at the top of each permission's condition block in `RolePermissionsDialogComponent`.

#### Multiple Roles and Condition Precedence

When a user has multiple roles, permissions are deduplicated by `effect:resource:action` key — so allow and deny rules for the same `(resource, action)` coming from different roles are preserved as separate entries. Within the same effect bucket, later roles override earlier ones; conditions are **not merged** across roles.

Example: if Role A grants `update:User` with `{ ownership: { userField: "id" } }` and Role B grants `update:User` with no conditions — the user gets **unrestricted** `update:User` (Role B overrides Role A on the allow side).

To apply multiple restrictions simultaneously, either use `$and` in a single `custom` condition on one role, or move the extra restrictions to a separate role with `effect: 'deny'`.

### User Management (Admin)
- **Unified Manage Users page** — inline filter form (single unified search field, role select, status) on the same page as the user list; empty filters load all users, filled filters trigger a search via `GET /users/search`. The `q` search is OR-matched across id/email/firstName/lastName; the `role` filter narrows to users having a role with that exact name
- **Infinite scroll** with column sorting — loads 20 users at a time through the cursor endpoints; the shared `nxsInfiniteScroll` sentinel requests the next page as the user scrolls, and keeps filling until the viewport is covered or the server stops handing out cursors
- User detail, edit, and **soft delete** — records are preserved with a `deleted_at` timestamp; all active sessions are revoked on delete; count decremented inline (no reload)
- **Restore** soft-deleted users via `POST /users/:id/restore` — clears `deleted_at` only. An account deactivated before deletion comes back deactivated; reactivation stays a `PATCH /users/:id { "isActive": true }` operation, so holding `users:delete` alone cannot re-enable a disabled account through a delete/restore round trip
- **"Include deleted users"** checkbox in the list filter form (`includeDeleted=true` on list and search). A deleted row shows a "Deleted" status chip and offers restore as its only action — the detail and edit endpoints exclude soft-deleted rows. Deleting a user while the filter is on flips the row in place instead of removing it
- Role assignment in user edit form — multi-select field (visible to users with `assign:Role` permission); diffs initial vs selected roles and issues `POST /roles/assign/:userId` / `DELETE /roles/assign/:userId/:roleId` calls on save
- **Effective permissions preview** — read-only `/admin/users/:id/permissions` page (linked from user detail) showing assigned roles, allow/deny/conditional summary chips, and a resource-grouped `mat-accordion` list of resolved permissions with per-rule action + effect chip and expandable CASL condition JSON; super-role users see a single "full access" note
- **Cursor pagination is the standard for every list.** Each list endpoint takes `cursor`, `limit` (capped at 100), `sortBy` (whitelisted per entity in `shared/src/constants/sort-columns.constants.ts`) and `sortOrder`, and answers `{ data, meta: { nextCursor, hasMore, limit } }`. Server: `applyKeysetPagination` over a `(sortColumn, id)` tuple; client: `withCursorList` + the `nxsInfiniteScroll` sentinel, one store per list. Covers users, the three billing lists and the roles / resources / actions / feature-flag catalogs. The offset envelope `{ data, meta: { page, limit, total, totalPages } }` is legacy and only still serves `GET /users` and `GET /users/search`. **Pickers are the deliberate exception:** a select, autocomplete or checkbox list that offers a whole catalog reads the unpaginated sibling endpoint (`GET /rbac/actions`, `GET /roles`, `GET /admin/feature-flags`) — feeding one from a page of the cursor list silently drops everything past the first page
- **Cursor-based (keyset) pagination** — alternative to offset-based, available via `/cursor` and `/search/cursor` endpoints with response `{ data: User[], meta: { nextCursor, hasMore, limit } }`
- **Sticky header** — toolbar remains fixed at the top while scrolling through long lists

### Billing (self-service)
- **Pricing page** (`/billing`) — plan tiers as cards with the recommended tier visually lifted (raised + primary accent + "Most popular" chip); currency follows the resolved provider; publicly accessible (anonymous visitors are sent to login on "Choose")
- **Checkout** — "Choose" starts a hosted-checkout session on the resolved provider and redirects; the return routes `/billing/success` (polls the subscription until active) and `/billing/cancel` confirm the outcome (the provider webhook is the source of truth)
- **Billing settings** (`/billing/settings`) — current plan with a semantic status chip, change-plan dialog, cancel-at-period-end (confirm dialog), a prepaid-credits wallet card, saved payment method with an update action, and a cursor-paginated invoice history (table on desktop, stacked cards on handset, infinite scroll under both)
- **Pay-as-you-go tier** — the metered `usage` plan is active in the catalog: the pricing page shows its per-unit teaser, and `GET /api/v1/billing/usage` returns the caller's current-period meter (total/included/billable units and the accrued amount)
- **Usage meter** — billing settings shows a current-period usage card for usage-mode subscriptions: large unit readout, a quota gauge when the plan includes units (used quota in the primary tone, overage in the error tone), and a money mini-ledger (billable units × unit price) ending in the accrued amount; pure pay-as-you-go plans skip the gauge
- **Plan change with proration** — the change-plan dialog in billing settings picks a billing mode (fixed / pay-as-you-go) and a target plan, then shows a live proration mini-ledger from `/change/preview` (YooKassa: credit − / charge + / bold "Due now"; Paddle: the net amount — the provider settles the split; a negative net reads "Refund due"). Confirming calls `POST /api/v1/billing/subscription/change`, which switches instantly: Paddle computes the proration itself (`subscriptions.update`, prorated immediately), YooKassa is settled server-side per the refund-and-recharge policy (charge the new plan's whole-day remainder first, then refund the old plan's unused remainder — two fiscal documents, both surfaced as receipt rows in the invoice history)
- **Payment-method update** — the "Update" button on the settings payment-method card calls `POST /api/v1/billing/payment-method` and redirects to the provider-hosted card replacement: Paddle returns its zero-amount payment-method-change checkout, YooKassa re-binds the card via a zero-amount payment whose success webhook swaps the default saved method (the old card is demoted, not deleted; the next renewal charges the new token); `past_due` subscriptions are allowed — fixing the card is how dunning recovers
- **Stable billing day** — a self-managed subscription keeps the day of the month it was opened on. Each boundary is derived from the recorded billing anchor rather than from the previous boundary, so a short month clamps once and the original day returns as soon as the next month is long enough (Jan 31 → Feb 28 → Mar 31 → Apr 30). A trial re-anchors to its conversion date; provider-managed subscriptions take every boundary from the provider
- **Billing region** — Auto / Russia / International control on the pricing page (authenticated only) that sets the provider used for the next checkout
- **One-time purchases** — a section below the plan grid (authenticated only) renders the `GET /api/v1/billing/products` catalog: fixed-price products as horizontal ticket cards (tonal icon, unlocked-entitlement meta, price + "Buy" split off by a dashed rule) and custom-amount products as a donation card (quick preset amounts derived from the catalog minimum, a bounded custom amount with client-side validation, an optional receipt note, and a pay button that always shows the live amount). The purchase session reference is parked in `sessionStorage` before the provider redirect; `/billing/success` detects it and polls the invoice list for the paid `one_time` invoice (keyed by the provider payment reference) instead of the subscription, ending in a thank-you card with the product and amount
- **Prepaid credit packs** — `credits` products in the one-time catalog (seeded 500/1000/5000-unit packs) render as the same ticket cards; a paid pack tops up the customer's prepaid credit balance (`GET /api/v1/billing/credits`), which metered usage spends before money is charged — a usage period fully covered by credits settles as a paid zero invoice with no provider charge. Refunding a credit-pack invoice up to its full amount (in one leg or several partial ones — refunds accumulate) claws the units back; if they were already spent the balance goes negative and new usage recording is blocked (409) until topped up
- **Credits wallet** — billing settings shows the balance as a wallet card sharing the catalog's ticket vocabulary (tonal toll icon, dashed punch line): a confident zero state ("0 credits — top up"), an overdrawn state in the error palette explaining that usage is paused, and a top-up/buy action leading to the credit packs on the pricing page
- **Entitlements as a first-class access axis** — `GET /api/v1/billing/entitlements` reports what a caller's billing state actually grants (plan in force, capabilities, numeric limits), and the client mirrors it in an `EntitlementsStore` behind a `*nxsHasEntitlement` structural directive with an optional else-template for an upgrade prompt. The mirror is advisory — the server's entitlement guard stays the boundary — and the plan catalog is deliberately not used as a substitute: it expresses neither one-time purchase grants, nor their expiry, nor the Free fallback, nor the full entitlements retained through the `past_due` grace window. Any billing change pushes an `entitlements_updated` SSE event to that one user, so the mirror refreshes instead of waiting out the cache TTL
- **Plan-driven concurrent sessions** — the numeric half of an entitlement is enforced, not decorative: how many refresh tokens a user may hold at once comes from the plan (`limits.sessions`, seeded Pro 10 / Business 25) and falls back to the built-in `MAX_CONCURRENT_SESSIONS` of 5 when the plan sets none. Resolved on **both** sign-in paths, password and OAuth, so a paid allowance is not silently trimmed by whichever one the user takes. The semantics are eviction rather than rejection — login always succeeds and the oldest device is dropped, which is why the UI reads "Devices at once: N" — and resolution **fails open** to the constant, so a billing outage can never become a login outage. A downgrade revokes nothing at plan-change time; the trim happens at that user's own next sign-in, so a catalog edit cannot log a whole tier out at once. The limit key space is a closed union (`EntitlementLimitKey`), so an invented or misspelled key is a compile error rather than a value nothing reads
- **Availability gating** — the billing nav entry and routes are hidden behind the public `billing` feature flag, which the server keeps off until at least one payment provider is configured
- Fully internationalized (EN / RU) via a lazy-loaded `billing` Transloco scope

### UI/UX
- Angular Material M3 component library — `mat.theme()` API with Azure/Violet palette, M3 design tokens (`--mat-sys-*`), pill-shaped navigation active indicators
- Light/dark theme with system preference detection; dark mode contrast ratios verified (7.9–14.4:1)
- **WCAG 2.1 AA** — skip link, `aria-label` / `aria-current` / `aria-expanded` on sidenav, `aria-hidden` on decorative icons, transloco-bound `aria-label` on toolbar controls
- **Runtime multilingual support (EN / RU)** — `@jsverse/transloco` with lazy-loaded per-feature scopes; language switcher in toolbar (flag icons); persisted to `localStorage`; server error keys translated client-side via shared `ErrorKeys` const
- **Interface density preference** — Profile → Preferences exposes an "Interface density" slider (Material density levels 0–5) applied at runtime via `data-ui-density` on `<html>` and persisted per-device in `localStorage`; overall size is intentionally left to the browser's own zoom
- **Keyboard shortcuts** — `Ctrl+S` / `Cmd+S` saves the active form; `?` or `Ctrl+/` opens a contextual shortcuts reference dialog; stack-based registration so dialog overlays handle shortcut scoping automatically
- Responsive SCSS architecture
- Snackbar error notifications
- Form validation with error messages; reusable password strength indicator (`<app-password-strength>`, 4-bar visual meter, aria-live label) shown in register, profile, and reset-password forms
- 404 and 403 pages
- Version display in toolbar (version + git hash via `MatTooltip`)
- **Collapsible side navigation** — persistent left panel (narrow 64px / wide 220px) with per-user localStorage persistence; auto-collapses to overlay mode on mobile (≤599px) via `BreakpointObserver`; hamburger button in toolbar opens the drawer. Links rendered from a permission-filtered `NavLink` registry on `SidenavStateService`; the root route auto-lands on the first accessible nav link (or `/profile` fallback) via `defaultRoute()`
- **Standardized dialog system** — `DialogSize` enum (`Confirm` / `Form` / `Wide`) with `dialogSizeConfig()` helper; all dialogs use Material Design 3 responsive `{ width: '90vw', maxWidth }` pattern; global `_dialogs.scss` handles title padding, Angular Material bug #26352 fix (floating label clipping), and `::before` spacer reset. **Adaptive confirm dialogs** — `AdaptiveDialogService.openConfirm()` opens confirm dialogs as bottom sheets on handset viewports and as standard dialogs on larger screens

### Versioning
- All three workspaces share a single version (see `package.json`)
- `client/scripts/version.mjs` auto-generates `src/environments/version.ts` before every build/start/test
- `npm run release` (from `client/`) bumps all `package.json` files, generates `CHANGELOG.md`, and creates a git tag
- Conventional Commits enforced via commitlint + husky `commit-msg` hook
- A `@name` written bare in a commit subject becomes a GitHub user mention in `CHANGELOG.md` and on the release page, crediting an unrelated account. Write code identifiers in backticks (`` `@Authorize` ``); commitlint rejects the bare form, and `client/scripts/at-mentions.mjs` escapes any that still get through — on changelog generation (`postchangelog`) and again before the release body is published

## Project Structure

```
fullstack-starter-app/
├── .github/workflows/      # CI/CD pipeline (GitHub Actions)
│   └── ci.yml              # Lint, test, build on push/PR to master
├── shared/                 # Shared types and constants (no build step)
│   ├── tsconfig.json       # Minimal config for IDE support
│   └── src/
│       ├── types/          # UserResponse, AdminUserResponse, AuthResponse, PaginatedResponse<T>,
│       │                   # RoleResponse (public) / RoleAdminResponse (with isSystem/isSuper),
│       │                   # PermissionResponse, UserPermissionsResponse, etc.
│       ├── constants/      # PASSWORD_REGEX, pagination defaults, SYSTEM_ROLES, MAX_CONCURRENT_SESSIONS,
│       │                   # ENTITLED/OPEN/CHANGEABLE_SUBSCRIPTION_STATUSES (one definition each), etc.
│       └── utils/          # feature-flag-evaluator, mongo-query-safety, time (Temporal barrel), money (BigInt value object)
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
│   │   │   ├── auth/           # JWT + refresh token auth, lockout, verification, reset, permissions endpoint
│   │   ├── mail/           # Email delivery (nodemailer, console/SMTP transports)
│   │   ├── users/          # User CRUD
│   │   ├── notifications/  # SSE push: NotificationsService, NotificationsListener, NotificationsController
│   │   └── roles/          # RBAC: Role/Permission/RolePermission entities, RolesController, PermissionsGuard
│   ├── src/common/
│   │   ├── dtos/           # PaginationQueryDto, PaginatedResponseDto<T>, CursorPaginationQueryDto, CursorPaginatedResponseDto<T>
│   │   ├── utils/          # escapeLikePattern, hashToken, withTransaction, extractAuditContext, cursor encode/decode, applyKeysetPagination
│   │   └── upload/         # createDiskStorageOptions() — reusable multer disk storage factory; validates extension + MIME type
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
        ├── middleware/      # Route handlers (auth, users, OAuth, notifications) + guards
        ├── sse-hub.ts      # SSE connection registry and push helpers
        ├── helpers/        # Auth helper utilities + requireUuid param guard
        ├── utils/          # mockId (slug -> stable UUID), cursor, period, listen, validation (class-validator mirrors)
        └── control.routes.ts  # Test control API (reset, seed, notify, invalidate-access-tokens, revoke-user-sessions)
```

Seed entities carry UUID ids, minted from a readable slug by `mockId()` (`utils/mock-id.ts`), because the
server guards every id path parameter with `ParseUUIDPipe`. `requireUuid()` mirrors that guard on the mock
routes, so a malformed id is a 400 in both, ahead of any lookup. Specs and E2E fixtures address seed rows
through `mockId('user-1')`, `mockId('role-editor')` and friends rather than through literal ids.

Request bodies follow the same rule: the server's global `ValidationPipe` runs before the handler, so a body
that fails its DTO is a 400 whether or not the addressed row exists. Mock handlers therefore run their
DTO-shape checks (type, length, enum, range) ahead of the entity lookup, and keep checks that need the
looked-up row - uniqueness, state transitions, remaining-total comparisons - below the 404.

The pipe also runs with `whitelist` + `forbidNonWhitelisted`, so a property no DTO declares is a 400 by
itself. `utils/validation.ts` mirrors the individual class-validator constraints (`unknownPropertyErrors`,
`trimmedStringErrors`, `intErrors`, `uuidErrors`, `iso8601Errors`, `oneOfErrors`) with the real validator's
message text and ordering - unknown properties first, then each property as declared - so a handler composes
its DTO from them and answers with the same envelope the server would. Note that `@IsUUID()` on a body field
is stricter than `ParseUUIDPipe` on a route param: it constrains the version and variant nibbles, so an id
can be a valid path parameter and an invalid body field.

All three workspaces import from `@app/shared/*` path alias (maps to `../shared/src/*` in each workspace's `tsconfig.json`).

## Prerequisites

- **Node.js 24** (pinned via `.nvmrc`)
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
| `JWT_ALGORITHM` | `RS256` | Signing algorithm: `HS256` (symmetric) or `RS256` (asymmetric) |
| `JWT_SECRET` | - | HS256 secret (min 16 chars; required when `JWT_ALGORITHM=HS256`) |
| `JWT_PRIVATE_KEY` | - | Base64-encoded RSA private key PEM (required when `JWT_ALGORITHM=RS256`) |
| `JWT_PUBLIC_KEY` | - | Base64-encoded RSA public key PEM (required when `JWT_ALGORITHM=RS256`) |
| `JWT_MIN_IAT` | - | Unix timestamp; tokens issued before this value are rejected (key rotation) |
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
| `TRUSTED_PROXIES` | - (local), `loopback,uniquelocal` (docker-compose) | Express `trust proxy` setting — required when running behind nginx / Caddy / K8s ingress / Cloudflare so `req.ip` resolves to the real client IP (used by throttlers and audit-log IP recording). Accepts `loopback` / `linklocal` / `uniquelocal`, an IP-CIDR list, a hop count, or `true`. The application has no built-in default; `docker-compose.yml` provides `loopback,uniquelocal` for prod deployments. See `server/README.md` "Deployment behind a reverse proxy" |
| `SWAGGER_ENABLED` | - | Set to `true` to enable Swagger UI in staging/production (always on in `local`/`development`) |
| `AUDIT_LOG_RETENTION_DAYS` | `90` | Days to retain audit log entries |
| `DB_POOL_MAX` | `10` | Maximum PostgreSQL connection pool size |
| `DB_POOL_IDLE_TIMEOUT` | `30000` | Milliseconds before an idle connection is closed |
| `DB_POOL_CONNECTION_TIMEOUT` | `5000` | Milliseconds to wait for a connection before erroring |
| `SMTP_FROM` | `noreply@example.com` | Default "from" address for emails |
| `ADMIN_EMAIL` | - | Email for the initial admin user (seeded on startup; skip if empty) |
| `ADMIN_PASSWORD` | - | Password for the initial admin user |
| `ADMIN_FIRST_NAME` | `Admin` | First name for the initial admin user |
| `ADMIN_LAST_NAME` | `User` | Last name for the initial admin user |
| `TURNSTILE_SITE_KEY` | - | Cloudflare Turnstile public site key. CAPTCHA on `/register` and `/forgot-password` is disabled while either key is empty. Get a real pair from `dash.cloudflare.com → Turnstile → Add site` (free). Test keys (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`) work for local dev and CI but are public — provide zero protection in production. See [`server/README.md` → "Enabling CAPTCHA in production"](server/README.md#enabling-captcha-in-production) |
| `TURNSTILE_SECRET_KEY` | - | Cloudflare Turnstile secret key for server-side `siteverify` calls. Paired with `TURNSTILE_SITE_KEY` |
| `PADDLE_API_KEY` | - | Paddle server API key. Paired with `PADDLE_WEBHOOK_SECRET`; both must be set for Paddle to count as configured |
| `PADDLE_WEBHOOK_SECRET` | - | Paddle webhook HMAC secret for signature verification |
| `PADDLE_ENVIRONMENT` | `sandbox` | Paddle API host: `sandbox` or `production` |
| `YOOKASSA_SHOP_ID` | - | YooKassa shop ID. Paired with `YOOKASSA_SECRET_KEY`; both must be set for YooKassa to count as configured |
| `YOOKASSA_SECRET_KEY` | - | YooKassa secret key |
| `YOOKASSA_VAT_CODE` | `1` | VAT code on every 54-FZ receipt line (1–6, tax-regime specific; `1` = "без НДС") |
| `BILLING_DEFAULT_CURRENCY` | `USD` | Default billing currency for new customers (`USD` or `RUB`) |
| `BILLING_PROVIDER_TIMEOUT_MS` | `20000` | Deadline for a single provider API call, in milliseconds. Neither provider SDK sets a transport timeout, so without it a stalled socket blocks the sequential renewal scan |
| `BILLING_WEBHOOK_IP_ALLOWLIST` | - (local), provider egress ranges (docker-compose) | Comma-separated IPs/CIDRs allowed to call the billing webhook receivers (`/api/v1/billing/webhooks/*`); other sources get `403` before any webhook processing. Empty disables the check; a malformed entry fails startup. `docker-compose.yml` defaults it to the published Paddle + YooKassa egress ranges. See ["Billing webhook source-IP allowlist" in `server/README.md`](server/README.md#billing-webhook-source-ip-allowlist) |
| `BILLING_WEBHOOK_RETENTION_DAYS` | `90` | Age at which a settled webhook delivery is deleted from the idempotency ledger by the daily retention sweep. Unfinished and dead-lettered deliveries are never pruned |
| `BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS` | `7` | Age at which a settled delivery's stored event is nulled out, ahead of the row itself. Keep below `BILLING_WEBHOOK_RETENTION_DAYS` |

### 3. Set up the database

```bash
cd server
npm run build
npm run migrations:run
npm run seed:run            # Optional: seed initial admin and RBAC data
```

`seed:run` is idempotent — every seeder inserts only the rows it is missing, so re-running it against an already-seeded database is a no-op rather than a unique-constraint error.

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
- **redis** — redis:7.4-alpine, used for distributed rate limiting and shared permission cache
- **db** — postgres:18-alpine, persistent named volume
- **server** — NestJS API on port 3000; entrypoint runs migrations, optional admin seed, then starts the server; exposes `GET /metrics` for Prometheus scraping; joins both `default` and the external `shared` network so a host Caddy can reach it as `server:3000`
- **client** — Angular SPA served by nginx on port 8080; host binding `127.0.0.1:4200:8080` (localhost-only; Caddy accesses internally via `client:8080`); built with `--base-href /nexus/` (overridable via `docker build --build-arg BASE_HREF=/`); joins both `default` and the external `shared` network. Declaring `shared` in compose (not attaching it manually) keeps the proxy reachable across container recreates
- **prometheus** — prom/prometheus:v3.12.0, internal network only (no ports exposed); scrapes `/metrics` every 15s, 30d retention; config at `monitoring/prometheus.yml`
- **grafana** — grafana/grafana:13.0.1, accessible at port 3001; provisioned datasource (Prometheus) and the **App Metrics** dashboard (HTTP traffic, per-route p95 latency, auth events, SSE connections, Node.js runtime, an RBAC & Reliability section: permission denials, process RSS, token-reuse alarm, uptime, queue/handle health, and a Mail Queue section: BullMQ depth by state and failed/completed job counts, a Database section: connection-pool depth by state, and a Cache section: per-cache hit ratio for the Redis-backed RBAC/feature-flag caches). See [`server/README.md` → "Observability"](server/README.md#observability) for the full metric list, Prometheus alert recipes for `rbac_permission_denied_total`, and an RBAC drill-down dashboard (`doc/grafana/rbac.json`). Grafana-managed alerting is provisioned from `monitoring/grafana/provisioning/alerting/` — see [Alerting](#alerting) below

### Alerting

`/health/ready` deliberately stays `ok` when a non-fatal dependency degrades (a failed SMTP verify, a
production instance running without `REDIS_URL`), so neither the container healthcheck nor the deploy
gate notices. The `dependency_up` gauge is the signal that does: the readiness indicators mirror their
outcome onto it (`1` healthy, `0` degraded or down), one series per dependency.

Two Grafana-managed rules watch it, provisioned as files (read-only in the UI, `provenance: file`):

| Rule | Expression | `for` | No-data behaviour |
|---|---|---|---|
| Dependency degraded | `dependency_up < 1` | 10m | `OK` — a missing series means the server is down, which the rule below owns |
| Server unreachable | `up{job="nestjs-server"} < 1` | 5m | `Alerting` |

The 10-minute window is deliberate: `SmtpHealthIndicator` memoizes its verify for 5 minutes, so a
sample can be one TTL stale and a shorter window would alert on an already-recovered dependency.
Worst-case detection latency is therefore ~15 minutes, against the five and a half weeks a dead SMTP
went unnoticed before this existed.

Delivery goes to a single webhook contact point (`ops-webhook`), read from `$ALERT_WEBHOOK_URL`. The
root notification policy is provisioned too, and is not optional: without it Grafana keeps routing to
its built-in email contact point, which would try to deliver "mail is down" by mail.

**Setting up the receiver:** create a webhook endpoint that accepts `POST` with a JSON body (an n8n
*Webhook* node with method `POST` and "Respond immediately" is enough), then store its URL as the
`ALERT_WEBHOOK_URL` repository secret. Both deploy workflows abort while the secret is empty, because
Grafana refuses to start with an empty webhook URL and would take the monitoring stack down with it.
The payload is Alertmanager-shaped: `status`, `alerts[].labels.{alertname,dependency,severity}`,
`alerts[].annotations.{summary,description}`. Routing on `severity` (`warning` vs `critical`) or on
`dependency` is done in the receiver, not in Grafana.

### Resource limits

Each service declares a conservative `mem_limit` as defense-in-depth: a single leaking or runaway
container can't starve the others of memory. Caps are derived from each service's own memory profile —
they sit above the container's measured peak working set (startup/migration spikes included), not
steady-state — so they hold regardless of the host the stack runs on:

| Service | `mem_limit` | `mem_reservation` |
|---|---|---|
| server | 384m | 128m |
| db | 256m | 96m |
| grafana | 384m | 192m |
| prometheus | 192m | — |
| redis | 96m | — |
| client | 64m | — |

Limits are ceilings, not reservations, so their sum can exceed available RAM. Container swap is left at
the default (no `memswap_limit`), giving a spill-to-swap safety valve before the kernel OOM-kills a process.

### Container hardening

Every service runs with `security_opt: no-new-privileges:true` and `cap_drop: ALL`. The two images whose
official entrypoints start as root and drop privileges via `gosu` re-add only the minimal capabilities
that drop needs: `redis` keeps `SETUID`/`SETGID`; `db` keeps `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `SETGID`,
`SETUID` (initdb + chown + the privilege drop). `server`, `client`, `prometheus`, and `grafana` already
run as non-root users on high ports and need no capabilities.

Every service also declares a `healthcheck`, so `restart: unless-stopped` recovers a hung-but-running
container, not just a crashed one — `prometheus` (`/-/healthy`) and `grafana` (`/api/health`) join the
existing checks on db/redis/server/client.

### Docker environment variables

In addition to the standard server env vars, set these in `server/.env` to provision an initial admin account on first startup:

```
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=YourSecurePass1
ADMIN_FIRST_NAME=Admin
ADMIN_LAST_NAME=User
```

The admin seeder is idempotent — it skips creation if the user already exists and does nothing if `ADMIN_EMAIL` is empty.

Set `GRAFANA_ADMIN_PASSWORD` as a shell environment variable before running `docker-compose up` to control the Grafana admin password (defaults to `admin` for local use only). Grafana is available at http://your-host:3001. In production this default never applies: the `deploy.yml` / `rebuild.yml` workflows abort before touching any container if the `GRAFANA_ADMIN_PASSWORD` secret is empty, so a cleared secret fails the deploy loudly instead of silently shipping `admin`/`admin`.

### Deploy pipeline

`.github/workflows/deploy.yml` — triggered manually (`workflow_dispatch`) or on push to `master`. Builds Docker images locally, scans with Trivy (HIGH/CRITICAL), pushes to GHCR only after both scans pass, and deploys to VPS with health checks and automatic rollback.

`.github/workflows/rebuild.yml` — weekly scheduled rebuild (Sundays 03:00 UTC) to pick up OS security patches. Rebuilds images with `no-cache`, scans, and deploys. Snapshots current images as `:pre-rebuild` for safe rollback. On a HIGH/CRITICAL finding it hands off to `scripts/auto-patch-cves.sh`, which upgrades the vulnerable Alpine packages (stable repositories first, edge as fallback) via a `CVE_PATCHES` block in the Dockerfile, re-scans, and opens a patch PR. If a CVE cannot be resolved (e.g. the fix conflicts with pinned sibling packages), it opens a tracking issue (label `auto-patch-blocked`) with the `apk` resolver conflict. The deploy stays blocked until a human acts.

`.github/workflows/edge-patch-cleanup.yml` — quarterly check that creates a PR to remove the Dockerfile `CVE_PATCHES` blocks once the fixes are present in the base image.

Both of those paths open their pull request with `GITHUB_TOKEN`, and GitHub does not start workflow runs for events raised by that token, so those PRs arrive with no CI behind them. Each PR body therefore opens with a required first action: close the pull request and reopen it, which is a human-initiated event and does start the full suite. Do not merge either one until those checks are green: both change the Dockerfiles that build the production images.

`.github/actions/preseed-ssh-client` — local composite action that installs the `drone-ssh` client used by `appleboy/ssh-action` before that action runs. The action downloads its worker binary from a GitHub release on every invocation and aborts the job when that URL is unavailable, which is how a deploy failed on six consecutive 503s. The composite action restores the binary from the Actions cache, checks it against a pinned sha256 and installs it where the action looks for it, so the action skips its own download. Two properties follow: in the steady state a deploy contacts no third-party release URL at all, and the executable that runs with the VPS SSH key is pinned by digest instead of being trusted on arrival. The pinned version and checksum live in that one file — bump them together, taking the value from the release's `checksums.txt`. Wired into every workflow that opens an SSH session to the VPS: `deploy.yml`, `rollback.yml`, `rebuild.yml` and `rotate-keys.yml`.

The same action also derives the SHA256 fingerprint of the `VPS_HOST_KEY` secret and exposes it as an output, which each of those four workflows passes to the SSH action's `fingerprint` input. That is what makes the client verify *which* host it is authenticating to: with no fingerprint the client accepts whatever key answers, and because a runner starts every run with an empty `known_hosts` the first-use trust gap would otherwise be re-opened on every deploy — with the deploy key and 21 further secrets on the other side of it. Keeping the derivation in the composite action puts it in one place instead of four, and an empty secret fails the step rather than quietly restoring the unverified behaviour. `rollback.yml`'s `resolve` job does not check the repository out, so it seeds `~/.ssh/known_hosts` from the same secret itself and connects with `StrictHostKeyChecking=yes`.

`.github/dependabot.yml` — keeps the `@sha256` base-image digests pinned in `server/Dockerfile` and `client/Dockerfile` current (docker ecosystem, weekly; major `node`/`nginx` bumps ignored), so builds are reproducible while still receiving reviewed upstream base updates.

Both deploy paths refresh the host checkout with `git pull --ff-only` and then check `docker-compose.yml` out at the commit whose images they are deploying, so a merge that lands while a deploy is in flight cannot pair a newer compose file with older images. `rollback.yml` does the same for its own target SHA. The next run restores the file before pulling.

All VPS-facing workflows share a `deploy-production` concurrency group to prevent race conditions. `rollback.yml` is the one member that sets `cancel-in-progress: true`, so an emergency rollback preempts whatever holds the group instead of queueing behind it — otherwise a wedged deploy blocks the rollback that exists to undo it. Every job that opens an SSH session also carries `timeout-minutes`, because the SSH action's own connect and command timeouts have been observed not to end a session against an unresponsive host.

### Production credentials & secrets

**Model:** all production secrets live in **GitHub repository secrets** and are the single source of
truth. On every `deploy.yml` / `rebuild.yml` run (after `git pull`), `scripts/sync-prod-env.sh` writes
them into the VPS `server/.env` (and root `.env` for `DB_PASSWORD`), so the on-disk env files are a
**derived artifact** — a from-scratch VPS rebuild restores credentials instead of silently dropping
email / auth / DB access. Each key is written **only when its secret is non-empty**; an unset secret
leaves the existing on-disk value untouched (safe to add a key before its secret is populated). Keys
not in the script (e.g. `JWT_MIN_IAT`, `JWT_ALGORITHM`, and non-secret config) are never touched.

**How `scripts/sync-prod-env.sh` works:** the deploy workflow exports the managed keys as environment
variables (from `${{ secrets.* }}`) and runs the script from the checkout root on the VPS. For each
managed key it calls an `upsert KEY VALUE FILE` helper that:
1. **skips empty values** — if the secret is unset/empty, the key is left exactly as it is on disk (no
   clobber), which is why adding a new managed key before its secret exists is a safe no-op;
2. **replaces or appends** — strips any existing `KEY=` line and writes the fresh `KEY=value`, so there
   are never duplicate lines and the value is updated in place;
3. **writes atomically** — builds a temp file and `mv`s it over the target, so a crash mid-write can't
   leave a half-written env file.

It targets `server/.env` for every managed key and additionally mirrors `DB_PASSWORD` into the root
`.env` (consumed by the `db`/postgres service), then `chmod 600`s both files. It only ever touches the
keys in its own list — any other line in `server/.env` (non-secret config, `JWT_MIN_IAT`, comments) is
preserved byte-for-byte. The script's header comment is the authoritative reference for the key list.

**Secret inventory:**

| GitHub secret | Used by | Injected into | Notes |
|---|---|---|---|
| `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` | all VPS workflows | — (SSH auth) | how Actions reaches the VPS |
| `VPS_HOST_KEY` | all VPS workflows | — (SSH host verification) | The VPS host's public key, one line in `ssh-keyscan` output format. Every SSH job verifies the far side against it before authenticating, so a redirected connection cannot collect the deploy key and the secrets forwarded with it. **An empty value fails the job by design** — the SSH client silently skips verification when it has no key to check against. **It must be the host's ECDSA key**: the host answers with whichever of its three host keys the client asks for, and the Go client inside `drone-ssh` prefers `ecdsa-sha2-nistp256`, so an `ssh-ed25519` value fails every job with `host key fingerprint mismatch` — while local OpenSSH, which prefers ed25519, verifies against it happily and makes the wrong key look correct. Re-take it (`ssh-keyscan -t ecdsa <host>`, checked against `/etc/ssh/ssh_host_ecdsa_key.pub` read on the host itself) if the host is ever reinstalled; a reboot or a resize keeps the same key. |
| `GITHUB_TOKEN` | all | — (GHCR login) | auto-provided by Actions |
| `GRAFANA_ADMIN_PASSWORD`, `GRAFANA_ROOT_URL` | deploy, rebuild | `docker-compose.yml` `${}` | Grafana container env. An empty `GRAFANA_ADMIN_PASSWORD` aborts the deploy (no silent `admin` default in prod). |
| `ALERT_WEBHOOK_URL` | deploy, rebuild | root `.env` → `docker-compose.yml` `${}` | Where Grafana POSTs firing alerts. An empty value aborts the deploy: Grafana exits at startup when a provisioned webhook has no URL. Treat as a capability — anyone who can POST to it can inject fake alerts. |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | deploy, rebuild, rotate-keys | `server/.env` | RS256 keypair (base64 PEM) |
| `DB_PASSWORD` | deploy, rebuild | `server/.env` + root `.env` | must equal the postgres volume's password — see caveat below |
| `GOOGLE_CLIENT_SECRET`, `FACEBOOK_CLIENT_SECRET`, `VK_CLIENT_SECRET` | deploy, rebuild | `server/.env` | OAuth client secrets |
| `ADMIN_PASSWORD` | deploy, rebuild | `server/.env` | initial-admin bootstrap password |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | deploy, rebuild | `server/.env` | outgoing email |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | deploy, rebuild | `server/.env` | Cloudflare Turnstile CAPTCHA on `/register` and `/forgot-password`. Site key is public but injected the same way for rebuild-safety; CAPTCHA stays disabled while either is empty — see [Enabling CAPTCHA in production](server/README.md#enabling-captcha-in-production) |
| `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` | deploy, rebuild | `server/.env` | Billing provider credentials. Billing stays hidden until a provider's full pair is set; left empty until a provider is connected |
| `CI_JWT_SECRET` | ci.yml | — (CI tests only) | not used in prod |

> **`DB_PASSWORD` caveat:** postgres bakes the password into its data volume on first init. Changing
> the `DB_PASSWORD` secret does **not** re-key an existing volume — the app would then fail to connect.
> Keep the secret equal to the live password; to truly rotate it, change it inside postgres too.

**Hand-maintained (not secrets, set directly in the VPS `server/.env`):** non-secret config —
`CLIENT_URL`, `CORS_ORIGINS`, `TRUSTED_PROXIES`, OAuth client **IDs** (`GOOGLE_CLIENT_ID`, …),
`ADMIN_EMAIL`, `JWT_ALGORITHM`, `JWT_MIN_IAT` (set by `rotate-keys.yml`), `BILLING_DEFAULT_CURRENCY`,
DB pool / logging settings.

**From-scratch VPS provisioning checklist:**
1. Install Docker + Compose; create the `deploy` user and `/home/deploy/nexus`; clone the repo there.
2. Ensure the `shared-network` Docker network exists and Caddy routes `/api`→`server`, `/nexus`→`client`.
3. Populate the GitHub secrets in the inventory above (all of them).
4. Create `server/.env` from `server/.env.example` and fill the **hand-maintained** (non-secret) keys;
   leave the secret-managed keys empty — the deploy will inject them.
5. Create root `.env` from `.env.example` (`DB_NAME`, `DB_USER`, image names); leave `DB_PASSWORD`
   empty (injected).
6. Trigger `deploy.yml` (`workflow_dispatch`). The sync script fills the secret-managed keys, the stack
   comes up, and `/api/health/ready` should report `database/redis/smtp: up`.

---

## API Documentation

Swagger docs are available at http://localhost:3000/swagger when the server is running in `local` or `development` environments. Can be enabled in any environment via `SWAGGER_ENABLED=true`.

API base URL: `/api/v1`

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | None | Register a new user |
| POST | `/auth/login` | None | Login — sets `refresh_token` HttpOnly cookie, returns access token |
| POST | `/auth/refresh-token` | None | Refresh access token (reads `refresh_token` cookie, rotates cookie) |
| POST | `/auth/logout` | Bearer | Logout, revokes refresh tokens |
| GET | `/auth/profile` | Bearer | Get current user profile |
| PATCH | `/auth/profile` | Bearer | Update own profile (name, password); `currentPassword` required when changing password (OAuth-only users may omit) |
| POST | `/auth/profile/email/initiate` | Bearer | Start self-service email change (throttled 3/h; requires current password; rejects OAuth-only accounts) |
| POST | `/auth/profile/email/confirm` | None | Confirm email change with the token sent to the new address (applies change in a transaction, revokes all sessions) |
| GET | `/auth/oauth/:provider` | None | Initiate OAuth login (google, facebook, vk) |
| GET | `/auth/oauth/:provider/callback` | None | OAuth provider callback |
| POST | `/auth/verify-email` | None | Verify email with token |
| POST | `/auth/resend-verification` | None | Resend verification email |
| POST | `/auth/forgot-password` | None | Request password reset email; CAPTCHA token required when near rate limit |
| GET | `/auth/captcha-config` | None | Public CAPTCHA configuration (site key, enabled flag) |
| POST | `/auth/reset-password` | None | Reset password with token |
| POST | `/auth/oauth/link-init` | Bearer | Initiate OAuth account linking — sets a short-lived link cookie so the next OAuth flow attaches the provider to the current user |
| POST | `/auth/oauth/exchange` | None | Exchange the post-callback OAuth-data cookie for the auth response (access token + refresh cookie) |
| GET | `/auth/oauth/accounts` | Bearer | List linked OAuth accounts |
| DELETE | `/auth/oauth/accounts/:provider` | Bearer | Unlink OAuth provider |
| GET | `/auth/permissions` | Bearer | Get current user's resolved permissions |
| GET | `/users` | `users:search` | List all users (paginated; `includeDeleted=true` to include soft-deleted) |
| GET | `/users/search` | `users:search` | Search users (paginated + filters: `q` (unified substring across id/email/firstName/lastName), email, firstName, lastName, `role` (exact role name), isActive; `includeDeleted=true`). String filters are capped at 255 chars and the boolean filters accept only `true`/`false` — anything else is a 400 |
| GET | `/users/cursor` | `users:search` | List users with cursor-based (keyset) pagination |
| GET | `/users/search/cursor` | `users:search` | Search users with cursor-based pagination + same filters as `/users/search` |
| GET | `/users/:id` | `users:read` | Get user by ID |
| GET | `/users/:id/permissions` | `users:read` | Get effective permissions (roles + resolved permissions + packed CASL rules) |
| POST | `/users` | `users:create` | Create user |
| PATCH | `/users/:id` | `users:update` | Update user (email, name, password, `isActive` deactivate/reactivate, `unlockAccount`); a password or email change revokes the target's sessions |
| DELETE | `/users/:id` | `users:delete` | Soft-delete user (sets `deleted_at`, revokes sessions) |
| POST | `/users/:id/restore` | `users:delete` | Restore soft-deleted user (clears `deleted_at`; leaves `isActive` untouched) |
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
| POST | `/roles/assign/:userId` | `roles:assign` | Assign role to user (404 when the user is unknown or soft-deleted) |
| DELETE | `/roles/assign/:userId/:roleId` | `roles:assign` | Remove role from user (404 when the user is unknown or soft-deleted) |
| GET | `/notifications/stream` | Bearer | SSE stream — pushes `session_invalidated`, `permissions_updated`, `user_crud_events` (only to clients with `users:search`) |
| GET | `/rbac/metadata` | `permissions:read` | Get RBAC metadata (resources + actions); Redis-cached 60s |
| GET | `/rbac/resources` | `permissions:read` | List all resources |
| PATCH | `/rbac/resources/:id` | `permissions:update` | Update resource display info |
| POST | `/rbac/resources/:id/restore` | `permissions:update` | Restore an orphaned resource; 400 if controller not registered |
| GET | `/rbac/actions` | `permissions:read` | List all actions |
| POST | `/rbac/actions` | `permissions:create` | Create a new action |
| PATCH | `/rbac/actions/:id` | `permissions:update` | Update action |
| DELETE | `/rbac/actions/:id` | `permissions:delete` | Delete custom action |
| GET | `/feature-flags` | None (optional) | Evaluate the flag set for the caller (authenticated → flags they resolve true + `public` flags; anonymous → `public: true` only) |
| GET | `/admin/feature-flags` | `feature-flags:manage` | List all feature flags (admin) |
| GET | `/admin/feature-flags/:id` | `feature-flags:manage` | Get a feature flag by ID |
| POST | `/admin/feature-flags` | `feature-flags:manage` | Create a feature flag |
| PATCH | `/admin/feature-flags/:id` | `feature-flags:manage` | Update a feature flag (optimistic locking via `If-Match`) |
| DELETE | `/admin/feature-flags/:id` | `feature-flags:manage` | Delete a feature flag |
| PUT | `/admin/feature-flags/:id/rules` | `feature-flags:manage` | Bulk-replace a flag's targeting rules |
| POST | `/admin/feature-flags/:id/preview` | `feature-flags:manage` | Preview how a flag evaluates for given attributes without saving |
| POST | `/admin/feature-flags/:id/toggle` | `feature-flags:manage` | Enable/disable a flag |

## Available Commands

> `format` / `format:check` cover every TypeScript and ESM file the workspace owns, not just `src/` — root-level configs (`eslint.config.*`, `playwright.config.ts`, `proxy.conf.mjs`, …) and `scripts/` are included. The `shared/` module and root-level `*.mjs` configs are formatted from `server/`, since they belong to no single workspace.

> `typecheck` exists in all three workspaces and is not redundant with `build`: `build` only typechecks what it compiles. `server/`'s `tsconfig.build.json` excludes `test/`, `*.spec.ts` and `common/testing/`; the client's `ng build` covers the `app` project only, and Playwright transpiles without typechecking, so `e2e/` is checked by nothing else. Each script runs the real project configs, never the base `tsconfig.json` — the client's base config is not a compilable program on its own (`e2e/` needs `types: ["node"]` and ESNext modules, specs need `lib: esnext.disposable`, the app project needs `types: []`). Run it in every affected workspace before pushing.

> The client splits the gate in two: `typecheck` (app + spec projects) and `typecheck:e2e` (e2e project + `playwright.config.ts`). They are separate because `e2e/` fixtures import mock-server sources, so the e2e project only typechecks where that workspace is installed — locally, and in the `Client E2E` CI job. Run both before pushing a client change.

### Mock Server (`cd mock-server`)

```bash
npm start                  # Start mock server (port 3000)
npm run start:dev          # Start with watch mode (ts-node-dev)
npm run typecheck          # tsc --noEmit (no build script — this is the type gate)
npm run lint               # Lint check
npm run format:check       # Prettier check
npm run check:imports      # Repo-wide cycle + barrel check (same script in all workspaces)
```

### Server (`cd server`)

```bash
npm run start:dev          # Dev server (port 3000, watch mode)
npm run build              # Production build
npm run typecheck          # tsc --noEmit incl. test/ and specs (excluded from build)
npm run lint               # Lint check
npm run lint:fix           # Lint and auto-fix
npm run format:check       # Prettier check
npm run format             # Prettier format
npm test                   # Unit tests (Jest)
npm run test:cov           # Test coverage
npm run check:imports      # Repo-wide cycle + barrel check (all four source roots)
npm run test:e2e           # E2E tests (pinned to Redis DB E2E_REDIS_DB, default 15, wiped per run)
npm run migrations:run     # Run migrations (build first)
npm run migrations:gen -- ./src/migrations/<kebab-name>  # Generate migration (build first)
npm run seed:run           # Run seeders (build first)
```

### Client

```bash
npm start                  # Dev server (port 4200, proxy to backend)
npm run build              # Production build
npm run typecheck          # tsc --noEmit over the app + spec projects
npm run typecheck:e2e      # tsc --noEmit over e2e/ + playwright.config.ts (needs mock-server installed)
npm run lint               # Lint check
npm run lint:fix           # Lint and auto-fix (TS + SCSS)
npm test                   # Unit tests (Vitest)
npm run check:imports      # Repo-wide cycle + barrel check (same script in all workspaces)
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
- **Passport strategies**: `LocalStrategy` (email/password), `JwtStrategy` (Bearer token; verifies signature and `tokenRevokedAt`, extracts `{ userId, email, roles }`), `GoogleStrategy`, `FacebookStrategy`, `VkStrategy` (OAuth, conditionally registered)
- **Secure-by-default routing**: `JwtAuthGuard` is registered globally via `APP_GUARD`; every endpoint requires a valid Bearer token unless explicitly opted out with `@Public()`. The `check-auth-coverage` e2e suite iterates the per-feature route manifests under `contracts/routes/` to enforce that no protected endpoint accidentally goes unauthenticated.
- **RBAC**: `RolesModule` provides `PermissionsGuard`, `PolicyEvaluatorService`, `PermissionService`, `CaslAbilityFactory`. `@Authorize(['action', 'Subject'])` typed tuples replace `@UseGuards(JwtAuthGuard, RolesGuard) @Roles()` on all protected endpoints
- **Request pipeline**: Global middleware -> Module middleware -> Guards -> Interceptors -> Pipes -> Controller
- **Pagination**: Offset-based (`PaginationQueryDto` / `PaginatedResponseDto<T>`) and cursor-based (`CursorPaginationQueryDto` / `CursorPaginatedResponseDto<T>`) — both available, reusable across endpoints
- **Cron jobs**: Daily expired token cleanup, weekly revoked token cleanup
- **Swagger** auto-generated API documentation

### Database

Nine tables managed via TypeORM migrations:

- **users** — UUID primary key, email (unique), name, bcrypt password hash (nullable for OAuth-only users), role/active flags, email verification (isEmailVerified, token, expiresAt), preferred `locale` (email language, default `en`), account lockout (failedLoginAttempts, lockedUntil), password reset (token, expiresAt), soft delete (`deleted_at TIMESTAMPTZ NULL`); ManyToMany to roles via user_roles
- **oauth_accounts** — Linked to users (CASCADE delete), provider + provider_id (unique), timestamps
- **refresh_tokens** — Linked to users (CASCADE delete), token string (SHA-256 hashed), expiry, revoked flag
- **roles** — UUID PK, name (unique), description, isSystem flag, isSuper flag; ManyToMany with users
- **resources** — UUID PK, name (unique), displayName, description, isSystem flag, `is_orphaned` boolean (true when controller was removed; its permissions stop granting, while deny rules keep applying until restored), `allowed_action_names text[]` (null = use all default actions)
- **actions** — UUID PK, name (unique), displayName, description, isSystem flag, sortOrder
- **permissions** — UUID PK, resource_id + action_id (unique constraint, FKs to resources and actions)
- **role_permissions** — FK to roles + permissions, optional jsonb `conditions` column
- **user_roles** — Join table (user_id, role_id), composite PK
- **feature_flags** — UUID PK, key (unique), description, enabled, environments `text[]` (GIN-indexed), public, version int, updated_by_user_id, timestamps
- **feature_flag_rules** — UUID PK, flag_id (FK CASCADE, btree-indexed), priority, type, effect, payload `jsonb`, timestamps
- **feature** — Auto-increment ID, name, timestamps

## Code Quality

| Tool | Scope | Config |
|------|-------|--------|
| ESLint | Client (angular-eslint, unused-imports, import cycles) | `eslint.config.mjs` |
| ESLint | Server (@typescript-eslint + prettier, import cycles) | `eslint.config.ts` |
| ESLint | Mock server (@typescript-eslint + prettier, import cycles) | `eslint.config.ts` |
| — | All three need `settings['import/parsers']` mapping `.ts` to `@typescript-eslint/parser`, or `import/no-cycle` silently passes on everything | — |
| ESLint | Shared rules for both workspaces (incl. a `no-restricted-syntax` ban on `as unknown as T` double casts) | `eslint.base.config.mjs` |
| Prettier | Both (single quotes, no trailing commas) | `.prettierrc` |
| Stylelint | Client SCSS (recess property order, no `px` units outside breakpoints) | `.stylelintrc.json` |
| Husky + lint-staged | Pre-commit hook (auto-fix staged files) | `.lintstagedrc.mjs` |
| Commitlint | Conventional Commits enforcement | `client/commitlint.config.mjs` |
| commit-and-tag-version | Automated versioning + CHANGELOG | `client/.versionrc.json` |
| check-imports | Repo-wide cycles, barrel rules (all four source roots) | `scripts/check-imports.mjs` |

### Import hygiene and barrels

`npm run check:imports` (available from any of the three workspaces; it walks the
whole repository, so one run covers everything) enforces four rules:

1. **Dependency cycles are an error.** TypeORM entity files are exempt — a
   bidirectional relation needs the related class as a value inside a lazily
   evaluated arrow, so `import type` is not available and the cycle is inherent
   to the ORM. Cycles whose every edge is `import type` are also skipped, since
   they are erased at compile time.
2. **A file must not import through a barrel that lives in its own directory.**
   Import the sibling module directly. This single pattern is what turns a
   barrel from a facade into a cycle.
3. **New barrels are an error.** Four are grandfathered in `ALLOWED_BARRELS`:
   `shared/src/types`, `shared/src/constants` (the cross-workspace public API of
   a package all three workspaces consume) plus `server/src/common/dtos` and
   `server/src/modules/core/filters`.
4. **A directory that has a barrel is entered through it.** No deep path from
   outside: `from '@app/shared/types'`, never
   `from '@app/shared/types/role.types'`. Rules 2 and 4 are one principle read
   from either side — the barrel is a directory's outside face and never its
   inside face. **Files inside `shared/src/` are exempt and must keep using deep
   paths**, because routing them through the barrels would close a cycle:
   `types/index.ts` re-exports `feature-flag.types`, which imports
   `../constants/feature-flag.constants`, while `constants/index.ts` re-exports
   `billing-flags.constants`, which imports `../types/billing.types`. That
   carve-out is `PACKAGE_API_ROOTS` in the script.

**Importing from `shared/`:** always through the barrel — `from
'@app/shared/constants'`, never `from '@app/shared/constants/auth.constants'`.
Both styles used to be in use; the barrel won because it makes `constants`
consistent with `types` and because the counter-argument turned out to be
empty — the client bundle measures 846.90 kB raw with deep imports and 846.83 kB
with the barrel, so nothing is lost to tree-shaking. A symbol you can only reach
by deep path is a barrel that needs the export added, not a deep import to
write. This was convention only until rule 4 was added, and 25 sites had drifted
off it by then. `shared/src/utils/` and `shared/src/enums/` have no barrel and
are still imported by full path — rule 4 says nothing about directories without
one.

The check is written in dependency-free Node rather than as an ESLint rule
because ESLint cannot lint files outside the directory containing its config, so
**`shared/` is linted by no workspace** — and that is exactly where the two
largest barrels live. It carries a `--self-test` that builds synthetic fixtures
and fails if any detector stops firing; CI runs that before the check itself.

`import/no-cycle` additionally runs in all three workspaces so a cycle surfaces
in the editor while you are writing it, rather than in CI. That rule is the fast
feedback loop; `check-imports.mjs` is the enforcement, and it is the only one of
the two that sees `shared/`. `server/` and `mock-server/` exempt `**/*.entity.ts`
for the TypeORM reason above, matching the script.

> **Changing either cycle rule?** Prove it still detects. Write a throwaway
> two-file cycle in that workspace's `src/`, confirm ESLint reports it, delete
> it. A green lint run is not evidence: this rule's failure mode is silence, and
> it sat dead in the client for exactly that reason.

### Git Hooks

A pre-commit hook (via [husky](https://typicode.github.io/husky/)) runs **lint-staged** on every commit. It applies auto-fix linting to staged files only:

| Glob | Linter |
|------|--------|
| `client/{src,e2e}/**/*.ts` | ESLint (angular-eslint + prettier) |
| `client/src/**/*.scss` | Stylelint |
| `server/src/**/*.ts` | Prettier + ESLint (@typescript-eslint) |
| `mock-server/src/**/*.ts` | Prettier + ESLint (@typescript-eslint) |
| `client/{*.{ts,mjs},scripts/*.mjs}` | Prettier |
| `server/{*.ts,scripts/*.ts}` | Prettier |
| `mock-server/*.ts` | Prettier |
| `shared/src/**/*.ts` | Prettier |
| `{.lintstagedrc.mjs,eslint.base.config.mjs}` | Prettier |

A commit-msg hook (`client/.husky/commit-msg`) additionally runs **commitlint** to enforce [Conventional Commits](https://www.conventionalcommits.org/) format and to reject bare `@name` mentions in the subject or body (see [Versioning](#versioning)).

Husky, lint-staged, and commitlint are installed in the `client/` sub-package. Running `npm install` inside `client/` activates the git hooks via the `prepare` script.

## Testing

| Type | Tool | Scope | Status |
|------|------|-------|--------|
| Server unit tests | Jest | `*.spec.ts` alongside source | 1935 tests passing |
| Server E2E tests | Jest | Separate config in `test/` | 325 tests; database and mail settings come from the environment first and `.env` for the rest, so a local `npm run test:e2e` reports 324 passing and 1 skipped (the mail suite, until `SMTP_HOST` points at a sink). CI runs without Redis and skips 7 |
| Client unit tests | Vitest | `*.spec.ts` alongside source, runner options in `client/vitest-base.config.mjs` | 1065 tests passing |
| Client E2E tests | Playwright | `e2e/` directory, uses mock-server (4 parallel workers) | 214 tests passing |
| Mock server | Express | `mock-server/` directory, provides full API simulation with RBAC support; parity specs in `src/__tests__/` assert its responses match the server's | 427 tests passing |

## CI/CD

GitHub Actions runs on every push and pull request to `master` with 5 jobs:

| Job | Depends on | Steps | Artifacts |
|-----|-----------|-------|-----------|
| **Server – Checks** | — | audit (high), lint, format:check, typecheck, check:routes, check:enums, check:permissions, check:i18n (validates all `ErrorKeys` values exist in every client i18n JSON), check:imports (repo-wide, preceded by its own `--self-test`) | — |
| **Server – Tests & Build** | server-checks | test:cov, build, migrations:run, E2E | Coverage report |
| **Mock Server** | — | audit (high), lint, format:check, typecheck, test | — |
| **Client** | — | audit (high), lint, format:check, typecheck, test:cov, build | Coverage report |
| **Client E2E** | mock-server | typecheck:e2e (after installing mock-server), ng build → serve (static), Playwright Chromium | HTML report, test results |

Concurrency groups cancel stale runs on rapid pushes. No database or `.env` file required — all tests run against mocks.

Every job sets an explicit `timeout-minutes` (10 for the two check jobs, 15 for `Client`, 20 for `Server – Tests & Build` and `Client E2E`). Without one a job inherits the six-hour default, so a hung step burns six hours of runner time before it fails. The bounds are several times each job's normal duration, so only a hang reaches them.

The `audit (high)` step in all three jobs runs `npm run audit:ci`, which wraps `npm audit --audit-level=high --omit=dev` in `scripts/audit-ci.mjs`. The wrapper exists because `npm audit` POSTs to the registry's advisory endpoint and the underlying fetch layer never retries POST requests, so a single 5xx from the registry reds the job with no source change. It retries up to 3 times, 15 s apart, **only** when the output carries `audit endpoint returned an error`; a genuine high-severity finding still fails on the first attempt.

## Security

- Passwords hashed with **bcrypt** (cost factor = 12)
- **Account lockout** after 5 failed login attempts (15-minute cooldown)
- **Email verification** required before first login
- **Password reset tokens** are single-use with 30-minute expiry; reset revokes all sessions
- **Admin password change** immediately revokes all sessions for the target user
- **Admin email change** does the same — the endpoint exists to recover an account whose address is attacker-controlled, so the previous holder must not keep authenticating with the tokens issued before the move. A resubmitted, unchanged address revokes nothing
- **Self-service password change** (`PATCH /auth/profile`) requires `currentPassword` to mitigate token theft → permanent account takeover; OAuth-only accounts (no password set) may omit the field when establishing their first password
- **HttpOnly refresh token cookie** (`SameSite=Strict`, `path=/api/v1/auth`, 7d expiry) — JavaScript cannot read or steal the token (XSS-proof); rotated on every use. **Reuse detection** (OAuth 2.0 BCP / RFC 6819): a revoked refresh token presented before its natural expiry triggers a full session purge for the user, a `TOKEN_REUSE_DETECTED` audit row, and `auth_events_total{event="token_reuse_detected"}` metric increment
- JWT access tokens (1h) stored in Angular signals only — never written to `localStorage`; user info persisted to `localStorage` (`auth_user` key) only to detect prior sessions on page reload
- `@Exclude()` decorator hides password in API responses
- **RBAC** — dynamic resources and actions with `@RegisterResource` auto-discovery; typed CASL permission checks via `PermissionsGuard` + `@Authorize(['action', 'Subject'])`; instance-level ownership enforcement on user mutations (`update`, `delete`, `restore`), role assignment (super-role escalation prevention) and role permission-set mutations; CASL ability hydrated at bootstrap before route activation; permissions cached per user (5 min); `isSuper` flag on roles bypasses all checks; `*appRequirePermissions="{ action, subject }"` directive for template-level visibility
- **Audit logging** — 41 security-sensitive actions (login, register, password change/reset, user/role/permission CRUD, OAuth link/unlink, logout, token refresh failures, feature-flag changes, and every admin billing mutation — subscription cancel, invoice refund, webhook-event replay, usage ingest) written to a dedicated `audit_logs` table with actor, target, IP, and request ID
- **`X-Request-Id` shape validation** — incoming `x-request-id` headers must match `^[A-Za-z0-9_-]{1,64}$`; non-conforming values are replaced with a fresh UUID before reaching audit rows, log lines, or Prometheus labels (prevents log injection and high-cardinality label abuse)
- `class-validator` on server DTOs with `whitelist: true` and `forbidNonWhitelisted: true` — unknown properties are stripped and requests with undeclared fields are rejected (prevents mass-assignment attacks); Angular `Validators` on client forms
- **An explicit `null` is not "absent"** — `@IsOptional()` skips every other validator for `null` as well as `undefined`, so an optional field would accept `null` and pass it on unvalidated. An optional field therefore keeps `@IsOptional()` only when its consumer defaults a `null` exactly as it defaults an omitted property (`value ?? fallback`, a truthiness check, or a genuinely nullable column); every other one uses `@ValidateIf(propertyIsDefined)` (`server/src/common/validators/property-is-defined.ts`), and DTOs built with `PartialType` pass the equivalent `{ skipNullProperties: false }`. Two failure shapes have been observed: `PATCH /auth/profile` with `{"password": null}` set the column to NULL and answered 200, leaving the account unable to log in, while the other identity fields turned a 400 into a NOT NULL violation reported as 500; and on the money path `POST /billing/purchase` with `{"amountMinor": null}` slipped past the "amount omitted" guard (`=== undefined`) and then compared as `0` against the product bounds, so a custom-amount product configured with a zero lower bound sent `null` to the payment provider as both the charge and the receipt line. `POST /billing/subscription/cancel` had the same shape one layer down — a `null` `mode` passed straight through the handler's default parameter, which only fills in for an omitted property. `PartialType`'s option does not cover a property the parent class already marks `@IsOptional()` — those are converted in the parent
- LIKE query pattern escaping to prevent SQL injection via wildcards
- File upload security: auth required, 5 MB limit, type whitelist, filename sanitization
- Configurable CORS (permissive only in `local` environment)
- Angular template escaping for XSS prevention

