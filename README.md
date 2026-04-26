# Fullstack Starter App

Full-stack TypeScript monorepo with **Angular 21** client and **NestJS 11** server, using PostgreSQL via TypeORM. Provides a production-ready foundation with authentication, user management, and theming.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | Angular | 21.2.5 |
| UI Library | Angular Material + CDK | 21.2.3 |
| Backend | NestJS | 11.1.17 |
| Database | PostgreSQL (TypeORM) | 0.3.28 |
| Language | TypeScript | 5.9.3 |
| Auth | JWT + HttpOnly-cookie refresh tokens + OAuth (Passport) | - |
| Client Tests | Vitest (unit), Playwright (e2e) | 4.0.18 / 1.58.2 |
| Server Tests | Jest (unit + e2e) | 30.2.0 |

## Features

### Authentication
- Email/password registration and login
- **Account lockout** — 5 consecutive failed login attempts lock the account for 15 minutes (HTTP 423 with countdown); admin can unlock early via user-edit page
- **Email verification** — new registrations require email verification before login (HTTP 403); resend-verification endpoint; OAuth users auto-verified
- **Password reset** — forgot-password sends a reset link (30-minute token expiry); reset invalidates all active sessions
- **OAuth2 login via Google, Facebook, VK** — auto-links by email, creates OAuth-only users
- JWT access tokens (1h, stored in-memory only) + opaque refresh tokens (7d, stored as HttpOnly `SameSite=Strict` cookie — never readable by JavaScript)
- Session restored on page reload via cookie-refresh in `provideAppInitializer` before route guards run
- Automatic token refresh 60 seconds before expiry
- 401 handling with request retry in JWT interceptor
- **Reactive permission refresh on 403** — `errorInterceptor` detects mid-session 403s, silently re-fetches `/api/v1/auth/permissions`, updates `AuthStore.ability`, and retries the request; `RequirePermissionsDirective` reacts via Angular `effect()` without a page reload
- **Real-time notifications via SSE** — `GET /api/v1/notifications/stream` (JWT-protected) pushes three event types: `session_invalidated` (force-logout on admin password change or user delete), `permissions_updated` (silent permissions re-fetch on role change), `user_crud_events` (admin user list auto-refresh on create/update/delete/restore). Client uses `HttpClient` with `observe: 'events'` so the existing JWT interceptor attaches the Bearer token; `NotificationsService` connects on login and disconnects on logout with exponential-backoff reconnect
- **Role-Based Access Control (RBAC)** — dynamic resources and actions with `@RegisterResource` auto-discovery; `isSuper` flag on roles replaces hardcoded admin bypass; `@Authorize(['action', 'Subject'])` typed tuples on server; `permissionGuard(action, subject)` + `instancePermissionGuard(action, subject, instanceFactory)` + `*appRequirePermissions="{ action, subject, instance? }"` directive on client; `/api/v1/rbac/` endpoints for managing resources and actions. `PermissionsGuard` attaches the built `AppAbility` to the request for downstream instance-level checks via `@CurrentAbility()`. Valid CASL subject names are auto-generated from `@RegisterResource` decorators into `shared/src/generated/casl-subjects.ts`
- `GET /api/v1/auth/permissions` returns CASL packed rules; client hydrates into `AppAbility` at bootstrap before route activation
- OAuth account management (link/unlink providers in profile)
- Server-side token cleanup via cron jobs
- **Audit logging** — security-sensitive operations recorded to `audit_logs` table (login, registration, password changes, user/role management, OAuth events); nightly cleanup removes entries older than `AUDIT_LOG_RETENTION_DAYS` days (default 90)

### Admin Panel
- **Role management** — tabbed `/admin` shell (`AdminPanelComponent`) with "Users", "Roles", and "Resources" tabs. Role list with create/edit/delete dialogs; `RolePermissionsDialogComponent` assigns permissions to roles with optional CASL conditions (ownership, fieldMatch, userAttr, custom)
- **Resource/Action management** — "Manage Resources" tab at `/admin/resources` (requires `read:Permission`). Resources table allows editing display name, description, and allowed actions per resource (`allowedActionNames`); Actions table supports create, edit, and delete of non-default actions. Each mutation refreshes `RbacMetadataStore` automatically
- **CASL condition editors** — all four condition types supported in the permissions dialog: `ownership` checkbox, `fieldMatch` / `userAttr` JSON editors, and a `custom` visual condition builder with field/operator/value form, nested `$or`/`$and` groups, JSON preview, and raw JSON fallback toggle
- **Prototype-pollution-safe `custom` conditions** — `CustomResolver` runs `findDeniedMongoKey()` on parsed user-supplied JSON before any merge; presence of `__proto__`/`constructor`/`prototype` keys vetoes the entire permission
- **Pluggable condition resolvers** — each branch of `PermissionCondition` (ownership, fieldMatch, userAttr, custom) is a standalone `ConditionResolver` strategy registered under the `CONDITION_RESOLVERS` token in `CaslModule`. To add a new condition type, implement the interface, register it in `condition-resolvers/index.ts`, and extend `PermissionCondition` in `shared/src/types/role.types.ts`

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

**Supported MongoDB operators** (evaluated by `@ucast/mongo2js` inside CASL):

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
| `$all` | Array contains all | `{ "tags": { "$all": ["urgent", "billing"] } }` |
| `$exists` | Field exists/absent | `{ "deletedAt": { "$exists": false } }` |
| `$regex` | Regex match | `{ "email": { "$regex": "@company\\.com$" } }` |

**Logical operators** (combine multiple conditions):

| Operator | Meaning | Example |
|----------|---------|---------|
| `$and` | All must match | `{ "$and": [{ "price": { "$lt": 100 } }, { "status": "active" }] }` |
| `$or` | Any must match | `{ "$or": [{ "status": "draft" }, { "status": "review" }] }` |
| `$nor` | None must match | `{ "$nor": [{ "status": "archived" }, { "status": "deleted" }] }` |
| `$not` | Negation | `{ "price": { "$not": { "$gt": 1000 } } }` |

Security: prototype pollution keys (`__proto__`, `constructor`, `prototype`) are silently skipped during parsing.

#### Combining Multiple Condition Types

Multiple types on the same permission are merged into one query (AND):

```json
{
  "ownership": { "userField": "id" },
  "fieldMatch": { "isActive": [true] },
  "custom": "{\"email\":{\"$regex\":\"@company\\\\.com$\"}}"
}
```

Produces:
```
can('update', 'User', {
  id: '<userId>',                      // from ownership
  isActive: { $in: [true] },           // from fieldMatch
  email: { $regex: '@company\\.com$' } // from custom
})
```

Meaning: user can update only their own record, only if it's active, and only if the email matches the company domain.

**Conflict resolution:** if the same field key appears in multiple condition types, later types overwrite earlier ones. Processing order: ownership → fieldMatch → userAttr → custom.

#### Practical Examples

| # | Scenario | Resource | Action | Condition | Result |
|---|----------|----------|--------|-----------|--------|
| 1 | User edits own profile | User | update | `{ "ownership": { "userField": "id" } }` | Edit button on own record only (default seed config) |
| 2 | Moderator deletes inactive users | User | delete | `{ "fieldMatch": { "isActive": [false] } }` | Delete button on inactive records only |
| 3 | Editor updates cheap products | Product | update | `{ "custom": "{\"price\":{\"$lt\":100}}" }` | Edit allowed only when `price < 100` |
| 4 | Support sees active EU/NA users | User | read | `{ "fieldMatch": { "isActive": [true] }, "custom": "{\"$or\":[{\"region\":\"EU\"},{\"region\":\"NA\"}]}" }` | Filtered to active users in EU or NA |
| 5 | Manager manages users they created | User | update | `{ "userAttr": { "createdBy": "id" } }` | Only records where `createdBy === managerId` |

#### Instance-Level Checks

**Server-side:** controllers inject `@CurrentAbility()` and pass it to the service, which loads the entity and calls `ability.can(action, entity)`. Returns 403 if denied.

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
- **Unified Manage Users page** — inline filter form (email, first/last name, status) on the same page as the user list; empty filters load all users, filled filters trigger a search via `GET /users/search`
- **Infinite scroll** with column sorting — loads 20 users at a time; `IntersectionObserver` sentinel triggers additional pages automatically as the user scrolls
- User detail, edit, and **soft delete** — records are preserved with a `deleted_at` timestamp; all active sessions are revoked on delete; count decremented inline (no reload)
- **Restore** soft-deleted users via `POST /users/:id/restore` — reactivates the account
- `includeDeleted=true` query param shows soft-deleted users in list and search
- Role assignment in user edit form — multi-select field (visible to users with `assign:Role` permission); diffs initial vs selected roles and issues `POST /roles/assign/:userId` / `DELETE /roles/assign/:userId/:roleId` calls on save
- **Effective permissions preview** — read-only `/admin/users/:id/permissions` page (linked from user detail) showing assigned roles, allow/deny/conditional summary chips, and a resource-grouped `mat-accordion` list of resolved permissions with per-rule action + effect chip and expandable CASL condition JSON; super-role users see a single "full access" note
- Pagination response envelope: `{ data: User[], meta: { page, limit, total, totalPages } }`
- **Cursor-based (keyset) pagination** — alternative to offset-based, available via `/cursor` and `/search/cursor` endpoints with response `{ data: User[], meta: { nextCursor, hasMore, limit } }`
- **Sticky header** — toolbar remains fixed at the top while scrolling through long lists

### UI/UX
- Angular Material M3 component library — `mat.theme()` API with Azure/Violet palette, M3 design tokens (`--mat-sys-*`), pill-shaped navigation active indicators
- Light/dark theme with system preference detection; dark mode contrast ratios verified (7.9–14.4:1)
- **WCAG 2.1 AA** — skip link, `aria-label` / `aria-current` / `aria-expanded` on sidenav, `aria-hidden` on decorative icons, transloco-bound `aria-label` on toolbar controls
- **Runtime multilingual support (EN / RU)** — `@jsverse/transloco` with lazy-loaded per-feature scopes; language switcher in toolbar (flag icons); persisted to `localStorage`; server error keys translated client-side via shared `ErrorKeys` const
- **Keyboard shortcuts** — `Ctrl+S` / `Cmd+S` saves the active form; `?` or `Ctrl+/` opens a contextual shortcuts reference dialog; stack-based registration so dialog overlays handle shortcut scoping automatically
- Responsive SCSS architecture
- Snackbar error notifications
- Form validation with error messages; password strength indicator on registration (4-bar visual meter)
- 404 and 403 pages
- Version display in toolbar (version + git hash via `MatTooltip`)
- **Collapsible side navigation** — persistent left panel (narrow 64px / wide 220px) with per-user localStorage persistence; auto-collapses to overlay mode on mobile (≤599px) via `BreakpointObserver`; hamburger button in toolbar opens the drawer
- **Standardized dialog system** — `DialogSize` enum (`Confirm` / `Form` / `Wide`) with `dialogSizeConfig()` helper; all dialogs use Material Design 3 responsive `{ width: '90vw', maxWidth }` pattern; global `_dialogs.scss` handles title padding, Angular Material bug #26352 fix (floating label clipping), and `::before` spacer reset. **Adaptive confirm dialogs** — `AdaptiveDialogService.openConfirm()` opens confirm dialogs as bottom sheets on handset viewports and as standard dialogs on larger screens

### Versioning
- All three workspaces share a single version (see `package.json`)
- `client/scripts/version.mjs` auto-generates `src/environments/version.ts` before every build/start/test
- `npm run release` (from `client/`) bumps all `package.json` files, generates `CHANGELOG.md`, and creates a git tag
- Conventional Commits enforced via commitlint + husky `commit-msg` hook

## Project Structure

```
fullstack-starter-app/
├── .github/workflows/      # CI/CD pipeline (GitHub Actions)
│   └── ci.yml              # Lint, test, build on push/PR to master
├── shared/                 # Shared types and constants (no build step)
│   ├── tsconfig.json       # Minimal config for IDE support
│   └── src/
│       ├── types/          # UserResponse, AuthResponse, PaginatedResponse<T>, RoleResponse,
│       │                   # PermissionResponse, UserPermissionsResponse, etc.
│       ├── constants/      # PASSWORD_REGEX, pagination defaults, SYSTEM_ROLES, MAX_CONCURRENT_SESSIONS, etc.
│       └── index.ts        # Barrel exports
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
        ├── helpers/        # Auth helper utilities
        └── control.routes.ts  # Test control API (reset, seed, notify)
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

### 3. Set up the database

```bash
cd server
npm run build
npm run migrations:run
npm run seed:run            # Optional: seed initial admin and RBAC data
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
- **redis** — redis:7-alpine, used for distributed rate limiting and shared permission cache
- **db** — postgres:16-alpine, persistent named volume
- **server** — NestJS API on port 3000; entrypoint runs migrations, optional admin seed, then starts the server; exposes `GET /metrics` for Prometheus scraping
- **client** — Angular SPA served by nginx on port 8080; host binding `127.0.0.1:4200:8080` (localhost-only; Caddy accesses internally via `client:8080`); built with `--base-href /nexus/` (overridable via `docker build --build-arg BASE_HREF=/`)
- **prometheus** — prom/prometheus:v2.54.1, internal network only (no ports exposed); scrapes `/metrics` every 15s, 30d retention; config at `monitoring/prometheus.yml`
- **grafana** — grafana/grafana:11.3.1, accessible at port 3001; provisioned datasource (Prometheus) and NestJS dashboard (18 panels: HTTP traffic, per-route p95 latency, auth events, SSE connections, Node.js runtime)

### Docker environment variables

In addition to the standard server env vars, set these in `server/.env` to provision an initial admin account on first startup:

```
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=YourSecurePass1
ADMIN_FIRST_NAME=Admin
ADMIN_LAST_NAME=User
```

The admin seeder is idempotent — it skips creation if the user already exists and does nothing if `ADMIN_EMAIL` is empty.

Set `GRAFANA_ADMIN_PASSWORD` as a shell environment variable before running `docker-compose up` to control the Grafana admin password (defaults to `admin` — change in production). Grafana is available at http://your-host:3001.

### Deploy pipeline

`.github/workflows/deploy.yml` — triggered manually (`workflow_dispatch`) or on push to `master`. Builds Docker images locally, scans with Trivy (HIGH/CRITICAL), pushes to GHCR only after both scans pass, and deploys to VPS with health checks and automatic rollback.

`.github/workflows/rebuild.yml` — weekly scheduled rebuild (Sundays 03:00 UTC) to pick up OS security patches. Rebuilds images with `no-cache`, scans, and deploys. Snapshots current images as `:pre-rebuild` for safe rollback.

`.github/workflows/edge-patch-cleanup.yml` — quarterly check that creates a PR to remove Dockerfile edge/main patches when fixes reach stable Alpine.

All VPS-facing workflows share a `deploy-production` concurrency group to prevent race conditions.

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
| GET | `/auth/oauth/:provider` | None | Initiate OAuth login (google, facebook, vk) |
| GET | `/auth/oauth/:provider/callback` | None | OAuth provider callback |
| POST | `/auth/verify-email` | None | Verify email with token |
| POST | `/auth/resend-verification` | None | Resend verification email |
| POST | `/auth/forgot-password` | None | Request password reset email |
| POST | `/auth/reset-password` | None | Reset password with token |
| GET | `/auth/oauth/accounts` | Bearer | List linked OAuth accounts |
| DELETE | `/auth/oauth/accounts/:provider` | Bearer | Unlink OAuth provider |
| GET | `/auth/permissions` | Bearer | Get current user's resolved permissions |
| GET | `/users` | `users:search` | List all users (paginated; `includeDeleted=true` to include soft-deleted) |
| GET | `/users/search` | `users:search` | Search users (paginated + filters: email, firstName, lastName, isActive; `includeDeleted=true`) |
| GET | `/users/cursor` | `users:search` | List users with cursor-based (keyset) pagination |
| GET | `/users/search/cursor` | `users:search` | Search users with cursor-based pagination + filters |
| GET | `/users/:id` | `users:read` | Get user by ID |
| GET | `/users/:id/permissions` | `users:read` | Get effective permissions (roles + resolved permissions + packed CASL rules) |
| POST | `/users` | `users:create` | Create user |
| PATCH | `/users/:id` | `users:update` | Update user |
| DELETE | `/users/:id` | `users:delete` | Soft-delete user (sets `deleted_at`, revokes sessions) |
| POST | `/users/:id/restore` | `users:delete` | Restore soft-deleted user (clears `deleted_at`, sets `isActive=true`) |
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
| POST | `/roles/assign/:userId` | `roles:assign` | Assign role to user |
| DELETE | `/roles/assign/:userId/:roleId` | `roles:assign` | Remove role from user |
| GET | `/notifications/stream` | Bearer | SSE stream — pushes `session_invalidated`, `permissions_updated`, `user_crud_events` |
| GET | `/rbac/metadata` | Bearer | Get RBAC metadata (resources + actions); Redis-cached 60s |
| GET | `/rbac/resources` | `permissions:read` | List all resources |
| PATCH | `/rbac/resources/:id` | `permissions:update` | Update resource display info |
| POST | `/rbac/resources/:id/restore` | `permissions:update` | Restore an orphaned resource; 400 if controller not registered |
| GET | `/rbac/actions` | `permissions:read` | List all actions |
| POST | `/rbac/actions` | `permissions:create` | Create a new action |
| PATCH | `/rbac/actions/:id` | `permissions:update` | Update action |
| DELETE | `/rbac/actions/:id` | `permissions:delete` | Delete custom action |

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
npm run migrations:gen -- ./src/migrations/<kebab-name>  # Generate migration (build first)
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
- **Guards**: `authGuard` (checks authentication + token refresh), `permissionGuard(action, subject)` (typed CASL check for route-level access), `adminPanelGuard` (OR check: search/User OR read/Role OR read/Permission), `guestGuard` (redirects authenticated users); `PermissionsGuard` checks RBAC permissions on server
- **Path aliases**: `@core/*`, `@features/*`, `@shared/*`

### Server

- **Modular NestJS architecture** with dynamic root `CoreModule`
- **Passport strategies**: `LocalStrategy` (email/password), `JwtStrategy` (Bearer token; verifies signature and `tokenRevokedAt`, extracts `{ userId, email, roles }`), `GoogleStrategy`, `FacebookStrategy`, `VkStrategy` (OAuth, conditionally registered)
- **Secure-by-default routing**: `JwtAuthGuard` is registered globally via `APP_GUARD`; every endpoint requires a valid Bearer token unless explicitly opted out with `@Public()`. The `check-auth-coverage` e2e suite iterates `contracts/routes.json` to enforce that no protected endpoint accidentally goes unauthenticated.
- **RBAC**: `RolesModule` provides `PermissionsGuard`, `PolicyEvaluatorService`, `PermissionService`, `CaslAbilityFactory`. `@Authorize(['action', 'Subject'])` typed tuples replace `@UseGuards(JwtAuthGuard, RolesGuard) @Roles()` on all protected endpoints
- **Request pipeline**: Global middleware -> Module middleware -> Guards -> Interceptors -> Pipes -> Controller
- **Pagination**: Offset-based (`PaginationQueryDto` / `PaginatedResponseDto<T>`) and cursor-based (`CursorPaginationQueryDto` / `CursorPaginatedResponseDto<T>`) — both available, reusable across endpoints
- **Cron jobs**: Daily expired token cleanup, weekly revoked token cleanup
- **Swagger** auto-generated API documentation

### Database

Nine tables managed via TypeORM migrations:

- **users** — UUID primary key, email (unique), name, bcrypt password hash (nullable for OAuth-only users), role/active flags, email verification (isEmailVerified, token, expiresAt), account lockout (failedLoginAttempts, lockedUntil), password reset (token, expiresAt), soft delete (`deleted_at TIMESTAMPTZ NULL`); ManyToMany to roles via user_roles
- **oauth_accounts** — Linked to users (CASCADE delete), provider + provider_id (unique), timestamps
- **refresh_tokens** — Linked to users (CASCADE delete), token string (SHA-256 hashed), expiry, revoked flag
- **roles** — UUID PK, name (unique), description, isSystem flag, isSuper flag; ManyToMany with users
- **resources** — UUID PK, name (unique), displayName, description, isSystem flag, `is_orphaned` boolean (true when controller was removed; excluded from CASL ability until restored), `allowed_action_names text[]` (null = use all default actions)
- **actions** — UUID PK, name (unique), displayName, description, isSystem flag, sortOrder
- **permissions** — UUID PK, resource_id + action_id (unique constraint, FKs to resources and actions)
- **role_permissions** — FK to roles + permissions, optional jsonb `conditions` column
- **user_roles** — Join table (user_id, role_id), composite PK
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
| Server unit tests | Jest | `*.spec.ts` alongside source | 463 tests passing |
| Server E2E tests | Jest | Separate config in `test/` | Configured |
| Client unit tests | Vitest | `*.spec.ts` alongside source | 374 tests passing |
| Client E2E tests | Playwright | `e2e/` directory, uses mock-server (4 parallel workers) | 136 tests passing |
| Mock server | Express | `mock-server/` directory, provides full API simulation with RBAC support | In use |

## CI/CD

GitHub Actions runs on every push and pull request to `master` with 5 jobs:

| Job | Depends on | Steps | Artifacts |
|-----|-----------|-------|-----------|
| **Server – Checks** | — | lint, format:check, check:routes, check:enums, check:permissions | — |
| **Server – Tests & Build** | server-checks | test:cov, build, migrations:run, E2E | Coverage report |
| **Mock Server** | — | lint, format:check, tsc, test | — |
| **Client** | — | lint, format:check, test:cov, build | Coverage report |
| **Client E2E** | mock-server | ng build → serve (static), Playwright Chromium | HTML report, test results |
| **Server – Checks** | — | check:i18n (validates all ErrorKeys exist in all i18n JSON files) | — |

Concurrency groups cancel stale runs on rapid pushes. No database or `.env` file required — all tests run against mocks.

## Security

- Passwords hashed with **bcrypt** (cost factor = 12)
- **Account lockout** after 5 failed login attempts (15-minute cooldown)
- **Email verification** required before first login
- **Password reset tokens** are single-use with 30-minute expiry; reset revokes all sessions
- **Admin password change** immediately revokes all sessions for the target user
- **Self-service password change** (`PATCH /auth/profile`) requires `currentPassword` to mitigate token theft → permanent account takeover; OAuth-only accounts (no password set) may omit the field when establishing their first password
- **HttpOnly refresh token cookie** (`SameSite=Strict`, `path=/api/v1/auth`, 7d expiry) — JavaScript cannot read or steal the token (XSS-proof); rotated on every use
- JWT access tokens (1h) stored in Angular signals only — never written to `localStorage`; user info persisted to `localStorage` (`auth_user` key) only to detect prior sessions on page reload
- `@Exclude()` decorator hides password in API responses
- **RBAC** — dynamic resources and actions with `@RegisterResource` auto-discovery; typed CASL permission checks via `PermissionsGuard` + `@Authorize(['action', 'Subject'])`; instance-level ownership enforcement on user mutations (`update`, `delete`, `restore`) and role assignment (super-role escalation prevention); CASL ability hydrated at bootstrap before route activation; permissions cached per user (5 min); `isSuper` flag on roles bypasses all checks; `*appRequirePermissions="{ action, subject }"` directive for template-level visibility
- **Audit logging** — 20 security-sensitive actions (login, register, password change/reset, user/role/permission CRUD, OAuth link/unlink, logout, token refresh failures) written to a dedicated `audit_logs` table with actor, target, IP, and request ID
- `class-validator` on server DTOs with `whitelist: true` and `forbidNonWhitelisted: true` — unknown properties are stripped and requests with undeclared fields are rejected (prevents mass-assignment attacks); Angular `Validators` on client forms
- LIKE query pattern escaping to prevent SQL injection via wildcards
- File upload security: auth required, 5 MB limit, type whitelist, filename sanitization
- Configurable CORS (permissive only in `local` environment)
- Angular template escaping for XSS prevention

