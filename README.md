# Fullstack Starter App

A full-stack TypeScript monorepo. It has an **Angular 21** client and a **NestJS 11** server, and it
uses PostgreSQL through TypeORM. It gives a production-ready foundation with authentication, user
management and theming.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | Angular | 21.2.21 |
| UI Library | Angular Material + CDK | 21.2.14 |
| Backend | NestJS | 11.2.1 |
| Database | PostgreSQL (TypeORM) | 0.3.31 |
| Language | TypeScript | 5.9.3 |
| Auth | JWT + HttpOnly-cookie refresh tokens + OAuth (Passport) | - |
| Client Tests | Vitest (unit), Playwright (e2e) | 4.1.11 / 1.62.1 |
| Server Tests | Jest (unit + e2e) | 30.4.2 |

## Features

### Authentication

- Registration and login with an email address and a password.
- **Account lockout.** 5 sequential failed logins lock the account for 15 minutes. The answer is HTTP
  423 with a countdown. The counter starts again when the window ends. A completed password reset
  clears the lock. An administrator can also unlock the account from the user-edit page.
- **Email verification.** A new registration requires email verification before the first login, and
  a login before that answers HTTP 403. A resend-verification endpoint is available.

  An OAuth user becomes verified only when the provider asserts `email_verified=true` for that same
  address. Google and Facebook do this. The rule applies at the creation of the account and at each
  later login. If the provider does not assert it, the server sends a verification email. The flag
  then stays false until the user opens the link.

  An administrator email change through `PATCH /api/v1/users/:id` sets `isEmailVerified` to false. It
  makes a new hashed verification token and sends a new verification email. The server enforces the
  uniqueness of the address. A conflict answers HTTP 409 with
  `errorKey: errors.users.emailExists` and `field: 'email'`.
- **Self-service email change.** A user can change their own email address from `/profile`. The flow
  has two steps and confirms at the new address.

  `POST /api/v1/auth/profile/email/initiate` needs authentication. It has a throttle of 3 calls each
  hour. It requires the current password and rejects an account that has OAuth only. It stores a
  hashed token on the user row for 1 hour. Then it sends a confirmation link to the new address. It
  also sends an alert with no link to the old address, and it masks the new address there.

  `POST /api/v1/auth/profile/email/confirm` applies the change inside a transaction. It checks the
  uniqueness again for the race window. It revokes each refresh token, and it notifies the old
  address.

  A partial unique index on `LOWER(pending_email)` keeps the set of `{email}` and `{pendingEmail}`
  globally unique. The dual-email checks in `register`, `users.update` and `users.create` do the
  same.

  On the client, one Save action carries the whole form. If the user confirms an address change, the
  client sends the initiate request and the `PATCH /api/v1/auth/profile` request in sequence. The
  initiate request goes first, because a password update makes a new hash of the credential that the
  initiate request verifies.

  `mock-server/` mirrors the new endpoints. It uses the same response shapes and the same
  enumeration-safe behavior.
- **Password reset.** The forgot-password flow sends a reset link, and the token expires in 30
  minutes. The reset invalidates each active session, clears an active lockout, and marks the address
  verified. The system mails the token only to that address, thus the redemption of the token proves
  control of the mailbox. Thus an account that OAuth created recovers in one step, and the server does
  not answer 403.
- **A CAPTCHA soft trigger on register and forgot-password.** The server activates the Cloudflare
  Turnstile challenge only when `X-RateLimit-Remaining` is 1 or less for the IP of the caller. Thus a
  legitimate user usually does not see it.

  The CAPTCHA is **disabled by default**. To activate it in production you need a free Cloudflare
  account. The included test keys give no protection against abuse in production. Use them for local
  development and for CI only. The deploy steps are in
  [`server/README.md`, "Enabling CAPTCHA in production"](server/README.md#enabling-captcha-in-production).

  The client reads the public site key from `GET /api/v1/auth/captcha-config`. It loads the Turnstile
  script only when the script is necessary.
- **OAuth2 login with Google, Facebook and VK.** The server never links a provider to an existing
  local account automatically, because that prevents an account takeover. The user must log in with
  their password and then link the provider from their profile.

  For an email address with no account, the server makes an OAuth-only user.

  A failed callback returns the browser to `/login?oauth_error=auth_failed`. It does not leave the
  browser on an API error page. An expired state cookie and a failed code exchange are two such
  failures.

  The server separates a declined consent screen from a true failure. A declined screen gives
  `oauth_error=oauth_cancelled` and its own message.

  A canceled **link** attempt and a failed link attempt return to `/profile`, which is where the
  attempt started. They do not leave an authenticated user on the login page.
- **The configuration gates the provider buttons automatically.** Each provider is a public feature
  flag: `oauth-google`, `oauth-facebook` or `oauth-vk`. Each flag has an attribute rule on a signal
  that the server registers from the environment. The signal is `oauth<Provider>Configured`, and it is
  true when `*_CLIENT_ID` has a value.

  A button appears only when the provider is configured **and** its flag is enabled. The flag is the
  manual override. The login page hides the full OAuth block when no provider qualifies. The
  "connected accounts" card in the profile hides a provider that is neither configured nor already
  linked. An administrator changes the flags at `/admin/feature-flags`.
- A JWT access token lives 1 h and stays in memory only. An opaque refresh token lives 7 days. The
  browser keeps it as an HttpOnly cookie with `SameSite=Strict`, thus JavaScript can never read it.
- The app restores the session after a page reload. `provideAppInitializer` does a cookie refresh
  before the route guards run.
- The client refreshes the token automatically 60 seconds before the expiry. It discards a response
  that arrives after the teardown of the session, and it does not restore the session.

  The refresh window lives in `shared/`. The server sets the floor of `JWT_EXPIRATION` at two times
  that window. Thus the server rejects a token lifetime that the client cannot schedule against, and
  it does this at boot instead of turning each open tab into a refresh loop.
- The JWT interceptor handles a 401 and retries the request.
- **A reactive permission refresh on a 403.** `errorInterceptor` finds a 403 in the middle of a
  session. It reads `/api/v1/auth/permissions` again silently, updates `AuthStore.ability`, and
  retries the request. `RequirePermissionsDirective` reacts through an Angular `effect()` and needs no
  page reload.
- **Real-time notifications through SSE.** `GET /api/v1/notifications/stream` is JWT-protected. It
  pushes three event types:
  - `session_invalidated` forces a logout after an administrator changes a password or deletes a
    user.
  - `permissions_updated` starts a silent permissions read. The server sends it when the roles of a
    user change, and when the permission set of a role that they hold changes. It goes to each
    connected holder of that role.
  - `user_crud_events` refreshes the administrator user list after a create, update, delete or
    restore. The server sends it only to a connected client whose current abilities permit
    `users:search`. Thus an ordinary user never sees these events.

  The client uses `HttpClient` with `observe: 'events'`, thus the existing JWT interceptor attaches
  the Bearer token. `NotificationsService` connects at login and disconnects at logout, and it
  reconnects with exponential backoff. It also recycles the connection each 4 h to 8 h, with jitter.
  Angular keeps the transport buffers for the life of a request, thus the recycle stops unbounded
  growth on a tab that stays open.
- **Role-Based Access Control (RBAC).** The resources and the actions are dynamic, and
  `@RegisterResource` discovers them automatically. The `isSuper` flag on a role replaces a hardcoded
  administrator bypass.

  On the server, `@Authorize(['action', 'Subject'])` takes a typed tuple. On the client there are
  `permissionGuard(action, subject)`, `instancePermissionGuard(action, subject, instanceFactory)` and
  the `*appRequirePermissions="{ action, subject, instance? }"` directive. The `/api/v1/rbac/`
  endpoints manage the resources and the actions.

  `PermissionsGuard` attaches the `AppAbility` object to the request. A downstream instance-level
  check reads it with `@CurrentAbility()`. A script generates the valid CASL subject names from the
  `@RegisterResource` decorators into `shared/src/generated/casl-subjects.ts`.
- `GET /api/v1/auth/permissions` returns the packed CASL rules. The client hydrates them into
  `AppAbility` at bootstrap, before the route activation.
- The profile page manages the OAuth accounts. A user can link a provider and unlink a provider.
- Cron jobs on the server clean up the tokens.
- **Audit logging.** The server records a security-sensitive operation in the `audit_logs` table.
  Examples are a login, a registration, a password change, user and role management, and an OAuth
  event. A nightly cleanup removes an entry that is older than `AUDIT_LOG_RETENTION_DAYS` days. The
  default is 90.
- **Feature flags.** This subsystem hides functionality that is in development. It also rolls
  functionality out progressively to a specific user, a role, a percentage, an attribute or an
  environment.

  `GET /api/v1/feature-flags` evaluates the flag set for the caller. An authenticated caller gets each
  flag that resolves true, plus each `public` flag. The server omits a disabled non-public flag. An
  anonymous caller gets the `public: true` flags only.

  The administrator CRUD is at `/api/v1/admin/feature-flags`. It uses optimistic locking through the
  `If-Match` header.

  An attribute rule can reference a `custom` key. The set of valid keys is not a constant: a module
  registers its keys in `onModuleInit`, thus the set is a property of the deployment.
  `GET /api/v1/admin/feature-flags/attribute-keys` reports it, and the rule editor offers it as an
  autocomplete. The editor also blocks a save that names an unregistered key, thus the administrator
  does not learn the valid set from a 400 after the flag itself was written.

  An anonymous user goes into a bucket by the `nxs_anon_id` cookie, which `AnonIdMiddleware` sets
  automatically. Thus a 10 % rollout of a public flag converges on the same 10 % of anonymous
  browsers across reloads.

  `FeatureFlagChangedListener` invalidates the cache on each change. It also coalesces the SSE
  broadcast of `{ type: 'feature_flags_updated' }`, thus a burst of changes causes one synchronized
  client refetch. The flag-list reload behind those refetches is single-flight.

  The per-user cache is keyed by a global version counter. Thus a change orphans each per-user entry
  and needs no Redis `SCAN MATCH`. A deployment with Redis increases the counter with an atomic
  `INCR`, thus simultaneous invalidations across instances cannot collapse into one version.

  The `environments` of a flag are restricted to the names that the server can run as, and the server
  normalizes them on a write. The `value` of an `attribute` rule must have a shape that its operator
  can compare. Without these two rules, the system stores a rule that looks active but can never
  match.

  `AttributeRegistryService` is the extensibility seam. Another module calls
  `registerAttribute('tenantId', resolver)` from `onModuleInit`. Thus it gives a tenant, an
  organization, a region or a subscription-tier attribute to the evaluator. The registered set
  reaches the administrator through `GET /api/v1/admin/feature-flags/attribute-keys`, thus a newly
  registered key shows in the rule editor with no client change.

  `@RequireFeature('key')` with `FeatureFlagGuard` is a convenience decorator that hides a route
  completely. It returns HTTP 404 against enumeration. RBAC stays the true authorization gate.

  The Angular client mirrors the surface. `FeatureFlagsStore` uses NgRx Signals. It loads at bootstrap
  on the authenticated path and on the rehydration path. It also does a non-blocking load for an
  anonymous visitor, thus a public flag can gate a preview on the landing page. The other pieces are
  `featureFlagGuard(key, redirectTo?)` for a route gate, the `*nxsHasFeature="'key'"` structural
  directive with an optional `nxsHasFeatureElse` template, and the `{{ 'key' | featureEnabled }}` pipe
  for an attribute binding.

  An SSE event starts `reload()`, thus an administrator toggle reaches a connected client with no
  refresh. `permissionsUpdated$` also starts `reload()`, thus a role-bound flag stays correct after a
  role change.

### Admin Panel

- **Role management.** `/admin` is a tabbed shell (`AdminPanelComponent`) with the tabs "Users",
  "Roles" and "Resources". The role list has create, edit and delete dialogs.
  `RolePermissionsDialogComponent` assigns the permissions to a role with optional CASL conditions:
  ownership, fieldMatch, userAttr and custom.
- **Resource and action management.** The "Manage Resources" tab is at `/admin/resources` and needs
  `read:Permission`. The Resources table edits the display name, the description and the allowed
  actions of each resource (`allowedActionNames`). The Actions table creates, edits and deletes a
  non-default action. Each mutation refreshes `RbacMetadataStore` automatically.
- **Billing console.** The "Billing" tab is at `/admin/billing`. It needs `manage:Billing`, and the
  public `billing` flag hides it. It shows read-only tables of the subscriptions and the invoices of
  each customer, as a table on a desktop and as cards on a handset.

  It has the two M1 mutations. The first cancels a subscription, at the end of the period or
  immediately, through a confirmation dialog. If the subscription is no longer open, the server
  answers with a conflict and does not cancel it a second time. The second refunds a paid invoice.

  Each list is cursor-paginated behind an infinite scroll, and each has its own store. Thus the page
  never reads a whole table. The console has full EN and RU translations.
- **CASL condition editors.** The permissions dialog supports the four condition types. `ownership`
  is a checkbox. `fieldMatch` and `userAttr` are JSON editors. `custom` is a visual condition builder
  with a field, operator and value form, nested `$or` and `$and` groups, a JSON preview, and a toggle
  to raw JSON.

  The `ownership`, `fieldMatch` and `userAttr` editors validate the shape of the condition inline. They
  use the shared finders of `permission-condition-shape.ts`, which are the rules that the server DTO
  applies. Thus a malformed condition blocks the save with a translated error and needs no 400 round
  trip. An example of a malformed condition is a `fieldMatch` value that is not a non-empty array.
- **Operator-safe `custom` conditions.** The `custom` branch runs `validateMongoQueryKeys()` on the
  parsed JSON from the user before any merge. That is the same allow-list that
  `PermissionConditionDto` applies on a write.

  Three inputs veto the whole permission: a `__proto__`, `constructor` or `prototype` key; a
  `$`-operator outside `ALLOWED_MONGO_OPERATORS`, such as `$where`, `$regex`, `$exists` or a typo; and
  a `$in` or `$nin` whose value is not an array of JSON scalars.

  The runtime layer uses the allow-list of the write layer. Thus a stored row cannot mean one thing to
  CASL and a different thing to the SQL list-filter translator. That translator cannot reproduce those
  operators. It also cannot bind anything except a scalar into `IN (:...p)`. For that reason the
  element rule of `fieldMatch` now also applies to raw `custom` JSON.
- **Condition translation.** `resolveConditions()` in
  `server/src/modules/auth/casl/resolve-conditions.ts` translates each branch of `PermissionCondition`
  to a MongoQuery. The branches are ownership, fieldMatch, userAttr and custom. The function merges
  them in that fixed order, and a later branch wins. The `ownership.userField` key is protected: a
  collision on it vetoes the permission. To add a new condition type, add a branch to
  `resolveConditions()` and extend `PermissionCondition` in `shared/src/types/role.types.ts`.
- **Fail-closed condition resolution.** A condition that the system cannot honor as it is authored
  vetoes the whole permission. It never degrades into a wider grant.

  These inputs veto the permission: a malformed branch shape, an unknown `userAttr` attribute, invalid
  or non-object `custom` JSON, a `custom` operator outside `ALLOWED_MONGO_OPERATORS`, and a
  restriction branch that resolves to an empty query. A malformed branch shape is a `fieldMatch` value
  that is not an array or that is an empty array, a `userAttr` attribute that is not a string, an
  `ownership.userField` that is empty or not a string, a prototype-pollution key, or a `$`-prefixed
  key or attribute name.

  The system never registers a partial resolution. A drop of the malformed part alone widens the
  intended restriction silently.

  A vetoed `deny` registers as an unconditional `cannot()`. Thus a broken deny rule never disappears
  silently. Only a condition object with no branch (a bare `effect`) registers unconditionally.
- **A delegated grant cannot widen the condition of the caller.** An administrator can hold a
  permission under a condition, for example `update:User` restricted to themselves. That administrator
  can give the permission to a role under an equal condition or a stricter condition. They cannot give
  it under a broader condition.

  The server compares the two as resolved queries. It rejects anything that is not provably narrower
  with a 403 and `errors.roles.conditionBroaderThanCaller`. Thus a delegated administrator cannot make
  a role with a wider condition and give that role to themselves. A super role is not affected.
- **The server rejects an identity-bound condition on a `create` grant.** `ownership` and `userAttr`
  both resolve to the id of the acting user. A record that does not exist yet can never carry that id.
  Thus one of these conditions on a `create` permission denies each create instead of restricting it.

  `RoleService` rejects such a grant with a 400 and `errors.roles.conditionNotApplicable`. It does this
  on the two permission-write routes, `PUT /roles/:id/permissions` and `POST /roles/:id/permissions`,
  for each caller and for a super role. The mock server mirrors the rule.

  `fieldMatch` and `custom` stay usable on `create`. The instance-level check on `POST /users`
  evaluates them against the submitted payload.
- **Condition shape validation at the input.** `PermissionConditionDto` enforces the inner shape of
  `ownership`, `fieldMatch` and `userAttr`. It uses the shared finders in
  `shared/src/utils/permission-condition-shape.ts`, which the client editors and the mock server also
  use.

  Thus the server rejects a partly malformed condition with a 400 at authoring time. It does not
  register a wider rule silently. An example is `{"status": ["active"], "dept": "sales"}`, where the
  author forgot the array brackets.

  A key that starts with `$` is rejected in the same way in the three branches. Such a key lands in
  the field position of the resolved MongoQuery, and the engine reads it as an operator. An allow
  grant then gives nothing, and a deny rule then stops denying.

### CASL Permission Conditions

The project uses [CASL](https://casl.js.org) (`@casl/ability` v6) with `MongoAbility`. That variant
evaluates a condition with the **MongoDB query syntax**, which has operators such as `$in`, `$lt` and
`$or`. This is a pure in-memory evaluation engine, through `@ucast/mongo2js` inside CASL v6. **No
MongoDB database is involved.**

#### How conditions work

Each permission on a role can have an optional `conditions` object. The database keeps it as JSONB in
`role_permissions.conditions`.

When the server builds the CASL ability of a user, it translates each condition into a MongoDB-style
query. CASL then evaluates that query against an entity instance at run time.

```
Without conditions:     can('update', 'User')                         -> allows updating ANY user
With conditions:        can('update', 'User', { id: currentUserId })  -> allows updating ONLY own record
```

The client reads the packed CASL rules from `GET /api/v1/auth/permissions`. It unpacks them into
`AppAbility` and evaluates the same conditions locally. Thus a UI element, such as an Edit button or a
Delete button, appears exactly when the server permits the operation.

#### Condition types

The type definition is in `shared/src/types/role.types.ts`:

```typescript
type PermissionCondition = {
  effect?: 'allow' | 'deny';                // default 'allow'
  ownership?: { userField: string };
  fieldMatch?: Record<string, unknown[]>;
  userAttr?: Record<string, unknown>;
  custom?: string;  // JSON-stringified MongoDB query
};
```

You can combine the four condition types on one permission. The system merges them into one query
with an implicit AND. The separate `effect` flag says whether the rule becomes a CASL `can()` (allow)
or a CASL `cannot()` (deny). Refer to "Deny rules" below.

---

**Type 1: `ownership`.** It restricts access to the records that the current user owns.

It sets `query[userField] = userId`, where `userId` is the id of the authenticated user.

| Admin UI | JSON stored |  Generated CASL rule |
|----------|-------------|---------------------|
| Checkbox with a field-name input (default: `"id"`) | `{ "ownership": { "userField": "id" } }` | `can('update', 'User', { id: '<userId>' })` |

Examples:

| Scenario | userField | Effect |
|----------|-----------|--------|
| A user edits their own profile | `"id"` | `User.id` must be equal to the id of the current user |
| An author edits their own posts | `"authorId"` | `Post.authorId` must be equal |
| A manager sees their own team | `"managerId"` | `Team.managerId` must be equal |

---

**Type 2: `fieldMatch`.** It restricts access by the values of a field. It is an allowlist.

The system translates each field to a `$in` operator: `query[field] = { $in: values }`.

| Admin UI | JSON stored | Generated CASL rule |
|----------|-------------|---------------------|
| JSON textarea | `{ "fieldMatch": { "status": ["active", "pending"] } }` | `can('read', 'Order', { status: { $in: ['active', 'pending'] } })` |

Examples:

| Scenario | Configuration | Effect |
|----------|--------------|--------|
| Support sees the active users only | `{ "isActive": [true] }` | Can read a user only when `isActive === true` |
| An editor manages draft and review posts | `{ "status": ["draft", "review"] }` | Cannot touch a published post |
| A regional manager | `{ "region": ["EU", "NA"] }` | Access is limited to the EU and NA records |

---

**Type 3: `userAttr`.** It maps a field of a record to an attribute of the user.

It resolves the attribute name from a user context object: `query[field] = userContext[attrName]`.

| Admin UI | JSON stored | Generated CASL rule |
|----------|-------------|---------------------|
| JSON textarea | `{ "userAttr": { "createdBy": "id" } }` | `can('update', 'User', { createdBy: '<userId>' })` |

The user context currently has one attribute: `{ id: userId }`. To add more, for example
`departmentId` or `tenantId`, extend the `userContext` object in
`CaslAbilityFactory.createForUser()`.

The difference from `ownership`: `ownership` always maps to `userId`. `userAttr` maps to any attribute
of the user. When the user context has more attributes, this becomes the most flexible built-in type.

---

**Type 4: `custom`.** It is a raw MongoDB query for a complex condition.

The value is a **JSON string**, that is a MongoDB query in string form. The system parses it and
merges it into the condition query key by key.

| Admin UI | JSON stored | Generated CASL rule |
|----------|-------------|---------------------|
| JSON textarea with validation | `{ "custom": "{\"price\":{\"$lt\":100}}" }` | `can('update', 'Product', { price: { $lt: 100 } })` |

**Supported MongoDB operators.** These are the only operators that a `custom` condition accepts. The
set is intentionally small. It holds only the operators that the SQL list-filter on the server can
reproduce exactly. Refer to the note below. Thus a condition behaves the same against one record and
as a filter on a list.

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

**Logical operators.** They combine two or more conditions:

| Operator | Meaning | Example |
|----------|---------|---------|
| `$and` | All must match | `{ "$and": [{ "price": { "$lt": 100 } }, { "status": "active" }] }` |
| `$or` | Any must match | `{ "$or": [{ "status": "draft" }, { "status": "review" }] }` |
| `$nor` | None must match | `{ "$nor": [{ "status": "archived" }, { "status": "deleted" }] }` |
| `$not` | Negation | `{ "price": { "$not": { "$gt": 1000 } } }` |

Security: the parser skips a prototype-pollution key silently. Those keys are `__proto__`,
`constructor` and `prototype`.

> **SQL translation on the server (`apply-ability.util.ts`).** The translator makes an SQL `WHERE`
> fragment from the CASL conditions for the user listing. It supports exactly the operators above,
> that is `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$and`, `$or`, `$nor` and `$not`.
> It supports them against the user fields `id`, `email`, `firstName`, `lastName` and `isActive`.
>
> The input validation rejects each other operator at the start. Thus the accepted set and the
> translatable set are identical, and a drift-guard test enforces this.
>
> An operand must be a scalar on the two sides. The translator checks a comparison value and each
> element of a `$in` or `$nin` array, because only a scalar can go into `IN (:...p)`.
>
> As defense in depth for data that already exists, the translator **drops** a rule that uses an
> operator or a field that it does not support, and a rule with a list that holds a non-scalar
> element. This is fail-closed, and the server logs a warning. Run
> `npm run check:role-conditions` in `server/` against a staging dump. It shows each existing row that
> this rule affects.
>
> The translator also translates a `deny` rule. It builds the allow group and the deny group
> separately and combines them as `allow AND NOT deny`. Thus a deny narrows the listing exactly as it
> narrows a check on one record. An unconditional deny reduces the listing to no rows.
>
> The fail-closed rule is asymmetric. A drop of an untranslatable allow only narrows the result. A
> drop of a deny widens it. Thus an untranslatable deny reduces the whole query to no rows, and the
> translator does not skip it.

#### Combining more than one condition type

The system merges the types on one permission into one query with an AND:

```json
{
  "ownership": { "userField": "id" },
  "fieldMatch": { "isActive": [true] },
  "custom": "{\"email\":{\"$in\":[\"a@company.com\",\"b@company.com\"]}}"
}
```

This gives:
```
can('update', 'User', {
  id: '<userId>',                              // from ownership
  isActive: { $in: [true] },                   // from fieldMatch
  email: { $in: ['a@company.com', ...] }       // from custom
})
```

The meaning: the user can update only their own record, only while that record is active, and only
when the email address is in the company domain.

**Conflict resolution.** If the same field key is in more than one condition type, a later type
overwrites an earlier type. The processing order is ownership, then fieldMatch, then userAttr, then
custom.

There is one exception. The `ownership.userField` key is protected. A `fieldMatch`, `userAttr` or
`custom` entry on that key replaces the owner-scoping predicate with a broader predicate. Thus the
system vetoes the whole permission and fails closed.

#### Practical examples

| # | Scenario | Resource | Action | Condition | Result |
|---|----------|----------|--------|-----------|--------|
| 1 | A user edits their own profile | User | update | `{ "ownership": { "userField": "id" } }` | The Edit button appears on their own record only. This is the default seed configuration |
| 2 | A moderator deletes inactive users | User | delete | `{ "fieldMatch": { "isActive": [false] } }` | The Delete button appears on an inactive record only |
| 3 | An editor updates inexpensive products | Product | update | `{ "custom": "{\"price\":{\"$lt\":100}}" }` | The edit is permitted only while `price < 100` |
| 4 | Support sees active EU and NA users | User | read | `{ "fieldMatch": { "isActive": [true] }, "custom": "{\"$or\":[{\"region\":\"EU\"},{\"region\":\"NA\"}]}" }` | The list holds the active users in the EU or in NA |
| 5 | A manager manages the users that they made | User | update | `{ "userAttr": { "createdBy": "id" } }` | Only a record where `createdBy === managerId` |

#### Instance-level checks

**On the server,** a controller injects `@CurrentAbility()` and gives it to the service. The service
loads the entity and calls `ability.can(action, entity)`. It returns a 403 on a denial.

On `UsersService` the ability parameter is **necessary**, and its type is `AbilityOrSystem`. Thus a
new caller cannot omit it and skip the filter or the instance check. A caller that truly acts with no
requesting principal gives the explicit `SYSTEM_ABILITY` sentinel. The self-service
`PATCH /auth/profile` route is such a caller, because its target is the authenticated user.

**On the client** there are three mechanisms.

1. The **`*appRequirePermissions` directive** works in a template. It evaluates for each row. It
   supports an optional `else` template, which shows a fallback when access is denied. An example is a
   disabled button with a tooltip instead of no button at all:
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

2. **`instancePermissionGuard`** works on a route. It runs before the route activation:
   ```typescript
   canActivate: [instancePermissionGuard('update', 'User', (route) => ({ id: route.params['id'] }))]
   ```

3. A **computed property** works in a component with complex logic:
   ```typescript
   canManageUser = computed(() => {
     const u = this.user();
     if (!u) return false;
     return this.authStore.hasPermissions({
       action: 'update', subject: 'User', instance: { id: u.id }
     });
   });
   ```

#### Super roles

A role with `isSuper: true` gets `can('manage', 'all')`. That is a CASL wildcard, and it bypasses each
condition check. Each button is visible, each route is available, and each API call is permitted.

This is the only path to a wildcard rule. The system rejects `manage` and `all` as an action name, and
`all` as a resource subject, when a person writes them. It rejects them again when it builds the
rules. A stored permission that carries one of the two keywords is skipped when it is an allow, and
the server logs this at `error` level. Such a permission is kept when it is a deny, because an
inverted wildcard can only restrict. The rule packer of the mock server applies the same guard.

#### Deny rules (`effect: 'deny'`)

Any permission on a role can set `effect: 'deny'` in its `conditions`. The factory then registers a
CASL `cannot()` rule instead of a `can()` rule.

The factory puts the allow rules first and the deny rules last. CASL uses the last matching rule.
Thus a deny always overrides an earlier allow for the same pair of resource and action.

A deny rule can carry the same MongoQuery conditions as an allow rule, that is ownership, fieldMatch,
userAttr and custom. Thus you can express these patterns:

- A blanket deny after an allow. Role A has `update:User` as an allow with no conditions. Role B has
  `update:User` with `{ effect: 'deny' }`. The net result: the user cannot update any user.
- A conditional deny. Role A has `update:User` with `{ ownership: { userField: 'createdBy' } }`, which
  is an allow for their own records. Role B has `update:User` with
  `{ effect: 'deny', fieldMatch: { status: ['locked'] } }`. The net result: the user can update their
  own records, except when `status === 'locked'`.

The administrator UI shows the flag as the "Deny" toggle. The toggle is at the top of the condition
block of each permission in `RolePermissionsDialogComponent`.

#### More than one role, and condition precedence

When a user has more than one role, the system deduplicates the permissions by the key
`effect:resource:action`. Thus an allow rule and a deny rule for the same pair of resource and action,
from two different roles, stay two separate entries.

Inside the same effect bucket, a later role overrides an earlier role. The system does **not** merge
the conditions across two roles.

Example: Role A grants `update:User` with `{ ownership: { userField: "id" } }`. Role B grants
`update:User` with no conditions. The user then gets **unrestricted** `update:User`, because Role B
overrides Role A on the allow side.

To apply more than one restriction at the same time, use one of two methods. Use `$and` in one
`custom` condition on one role. Or move the additional restrictions to a separate role with
`effect: 'deny'`.

### User Management (Admin)

- **One Manage Users page.** An inline filter form is on the same page as the user list. It has one
  unified search field, a role select and a status select. Empty filters load all users. Filled
  filters start a search through `GET /users/search/cursor`. The `q` value matches with an OR across
  the id, the email, the first name and the last name. The `role` filter narrows the list to the users
  that have a role with that exact name.
- **Infinite scroll** with column sorting. The page loads 20 users at a time through the cursor
  endpoints. The shared `nxsInfiniteScroll` sentinel requests the next page while the user scrolls. It
  continues until the page fills the viewport or the server gives no more cursors.
- A user detail page, a user edit page, and a **soft delete**. A soft delete keeps the record and sets
  a `deleted_at` timestamp. It revokes each active session. The count decreases in place and needs no
  reload.
- **Restore** a soft-deleted user with `POST /users/:id/restore`. The restore clears `deleted_at`
  only. An account that a person deactivated before the delete comes back deactivated. Reactivation
  stays a `PATCH /users/:id { "isActive": true }` operation. Thus `users:delete` alone cannot enable a
  disabled account through a delete and restore sequence.
- An **"Include deleted users"** checkbox is in the filter form of the list. It sends
  `includeDeleted=true` on the list and on the search. A deleted row shows a "Deleted" status chip and
  offers restore as its only action, because the detail endpoint and the edit endpoint exclude a
  soft-deleted row. A delete while the filter is on changes the row in place and does not remove it.
- Role assignment is in the user edit form. It is a multi-select field, and it is visible to a user
  with the `assign:Role` permission. On a save it compares the initial roles with the selected roles.
  Then it sends `POST /roles/assign/:userId` and `DELETE /roles/assign/:userId/:roleId` calls.
- **Effective permissions preview.** The read-only page is at `/admin/users/:id/permissions`, and the
  user detail page links to it. It shows the assigned roles and the allow, deny and conditional
  summary chips. It also shows a `mat-accordion` list of the resolved permissions, grouped by
  resource. Each rule has an action chip and an effect chip, and its CASL condition JSON expands. A
  user with a super role sees one "full access" note.
- **Cursor pagination is the standard for each list.** Each list endpoint takes `cursor`, `limit`
  (with a cap of 100), `sortBy` and `sortOrder`. `sortBy` has a whitelist for each entity in
  `shared/src/constants/sort-columns.constants.ts`. Each endpoint answers
  `{ data, meta: { nextCursor, hasMore, limit } }`.

  On the server, `applyKeysetPagination` works on a tuple of `(sortColumn, id)`. On the client,
  `withCursorList` works with the `nxsInfiniteScroll` sentinel, and each list has one store.

  A sortable column must be NOT NULL. It must also hold no precision that the cursor cannot carry.
  Thus a timestamp sort key is a `timestamptz(3)` column, because the cursor encodes the value with
  millisecond precision.

  This standard covers the users, the three billing lists, and the catalogs of the roles, the
  resources, the actions and the feature flags. **Offset pagination does not exist in this
  repository.** No list endpoint reports a `total`, because a keyset query cannot produce one without
  a second COUNT over the whole table.

  **A picker is the intentional exception.** A select, an autocomplete or a checkbox list that offers
  a whole catalog reads the unpaginated sibling endpoint: `GET /rbac/actions`, `GET /roles`,
  `GET /admin/feature-flags` or `GET /admin/feature-flags/attribute-keys`. If you feed a picker from a page of the cursor list, the picker drops
  each item after the first page silently.
- **Sticky header.** The toolbar stays at the top while the user scrolls through a long list.

### Billing (self-service)

- **Pricing page** (`/billing`). The plan tiers are cards, and the recommended tier is lifted with a
  raised elevation, a primary accent and a "Most popular" chip. The currency follows the resolved
  provider. The page is public, and "Choose" sends an anonymous visitor to the login page.
- **Checkout.** "Choose" starts a hosted-checkout session on the resolved provider and redirects the
  browser. The return route `/billing/success` polls the subscription until it is active. The return
  route `/billing/cancel` shows the other outcome. The provider webhook is the source of truth.
- **Billing settings** (`/billing/settings`). The page shows the current plan with a semantic status
  chip, the change-plan dialog, and the cancel action. The cancel action opens a confirmation dialog.
  On a metered plan that dialog says that the system charges the usage of the period at the close of
  the period.

  The page also shows a prepaid-credits wallet card, the saved payment method with an update action,
  and the invoice history. The invoice history is cursor-paginated. It is a table on a desktop and
  stacked cards on a handset, and the two layouts have an infinite scroll.
- **Pay-as-you-go tier.** The metered `usage` plan is active in the catalog. The pricing page shows
  its price for each unit. `GET /api/v1/billing/usage` returns the meter of the current period for the
  caller. It gives the total units, the included units, the billable units and the accrued amount.
- **Usage meter.** The billing settings page shows a usage card for the current period of a usage-mode
  subscription. It has a large unit readout. It has a quota gauge when the plan includes units, where
  the used quota is in the primary tone and the overage is in the error tone. It ends with a money
  mini-ledger, which multiplies the billable units by the unit price and shows the accrued amount. A
  pure pay-as-you-go plan has no gauge.
- **Plan change with proration.** The change-plan dialog in the billing settings selects a billing
  mode (fixed or pay as you go) and a target plan. Then it shows a live proration mini-ledger from
  `/change/preview`. For YooKassa the ledger shows a credit line, a charge line and a bold "Due now"
  line. For Paddle it shows the net amount, because the provider settles the two parts. A negative net
  amount reads "Refund due".

  The Confirm button calls `POST /api/v1/billing/subscription/change`, which switches the plan
  immediately. Paddle computes the proration itself, through `subscriptions.update` with immediate
  proration. The server settles YooKassa with the refund-and-recharge policy: it charges the whole-day
  remainder of the new plan first, and then it refunds the unused remainder of the old plan. That
  makes two fiscal documents, and the invoice history shows the two as receipt rows.
- **Payment-method update.** The "Update" button on the payment-method card in the settings calls
  `POST /api/v1/billing/payment-method`. Then it redirects to the card replacement page of the
  provider.

  Paddle returns its zero-amount payment-method-change checkout. YooKassa binds the card again with a
  zero-amount payment, and its success webhook changes the default saved method. The old card is
  demoted and not deleted, and the next renewal charges the new token.

  A `past_due` subscription can use this route, because a correction of the card is how dunning
  recovers.
- **A stable billing day.** A self-managed subscription keeps the day of the month on which a person
  opened it. Each boundary comes from the recorded billing anchor and not from the previous boundary.
  Thus a short month clamps one time, and the original day returns as soon as the next month is long
  enough. For example, January 31 gives February 28, then March 31, then April 30. A trial anchors
  again to its conversion date. A provider-managed subscription takes each boundary from the provider.
- **Billing region.** The pricing page shows an Auto, Russia and International control to an
  authenticated user. The control sets the provider of the next checkout.
- **One-time purchases.** A section below the plan grid renders the `GET /api/v1/billing/products`
  catalog for an authenticated user.

  A fixed-price product is a horizontal ticket card. It has a tonal icon, the unlocked entitlement in
  the meta line, and a dashed rule between the price and the "Buy" button.

  A custom-amount product is a donation card. It has quick preset amounts that come from the catalog
  minimum. It has a bounded custom amount with validation on the client. It has an optional receipt
  note. Its pay button always shows the live amount.

  The client parks the purchase session reference in `sessionStorage` before the redirect to the
  provider. `/billing/success` finds the reference and polls the invoice list for the paid `one_time`
  invoice, keyed by the payment reference of the provider. It does not poll the subscription. It ends
  with a thank-you card that shows the product and the amount.
- **Prepaid credit packs.** The one-time catalog holds `credits` products. The seeder ships packs of
  500, 1000 and 5000 units. They render as the same ticket cards.

  A paid pack adds units to the prepaid credit balance of the customer, which
  `GET /api/v1/billing/credits` reports. Metered usage spends the credits before the system charges
  money. A usage period that the credits fully cover settles as a paid invoice of zero, with no charge
  at the provider.

  A refund of a credit-pack invoice up to its full amount takes the units back. The refund can be one
  leg or several partial legs, because the refunds accumulate. If the customer already spent the
  units, the balance becomes negative. The system then blocks a new usage record with a 409 until the
  customer adds credits.
- **Credits wallet.** The billing settings page shows the balance as a wallet card. The card shares
  the ticket vocabulary of the catalog, that is a tonal toll icon and a dashed punch line. It has a
  confident zero state that reads "0 credits - top up". It has an overdrawn state in the error
  palette, which says that usage is paused. It has a top-up action that goes to the credit packs on
  the pricing page.
- **Entitlements are a first-class access axis.** `GET /api/v1/billing/entitlements` reports what the
  billing state of a caller truly gives: the plan in force, the capabilities and the numeric limits.

  The client mirrors it in an `EntitlementsStore` behind a `*nxsHasEntitlement` structural directive.
  The directive takes an optional else-template for an upgrade prompt. The mirror is advisory, and the
  entitlement guard on the server stays the boundary.

  The plan catalog is intentionally not a substitute. The catalog expresses neither a one-time
  purchase grant, nor the expiry of such a grant, nor the Free fallback, nor the full entitlements
  that the customer keeps through the `past_due` grace window.

  Each billing change pushes an `entitlements_updated` SSE event to that one user. Thus the mirror
  refreshes and does not wait for the cache TTL.
- **Plan-driven concurrent sessions.** The system enforces the numeric half of an entitlement, and it
  is not decorative. The number of refresh tokens that a user can hold at one time comes from the plan
  (`limits.sessions`, seeded as Pro 10 and Business 25). If the plan sets none, the value falls back
  to the built-in `MAX_CONCURRENT_SESSIONS` of 5.

  The system resolves the value on **both** sign-in paths, that is the password path and the OAuth
  path. Thus the path that the user takes cannot trim a paid allowance silently.

  The semantics are eviction and not rejection. A login always succeeds, and the system drops the
  oldest device. For that reason the UI reads "Devices at once: N".

  The resolution **fails open** to the constant. Thus a billing outage can never become a login
  outage.

  A downgrade revokes nothing at the time of the plan change. The trim occurs at the next sign-in of
  that user. Thus a catalog edit cannot log out a whole tier at one time.

  The key space of the limits is a closed union (`EntitlementLimitKey`). Thus an invented key or an
  incorrect key is a compile error and not a value that nothing reads.
- **Availability gating.** The public `billing` feature flag hides the billing navigation entry and
  the billing routes. The server keeps the flag off until a person configures at least one payment
  provider.
- The billing feature has full EN and RU translations, through a `billing` Transloco scope that loads
  on demand.

### UI and UX

- The Angular Material M3 component library. The project uses the `mat.theme()` API with the Azure and
  Violet palette, the M3 design tokens (`--mat-sys-*`), and pill-shaped active indicators in the
  navigation.
- A light theme and a dark theme, with detection of the system preference. A person verified the
  contrast ratios of the dark mode, which are 7.9:1 to 14.4:1.
- **WCAG 2.1 AA.** The app has a skip link. The sidenav has `aria-label`, `aria-current` and
  `aria-expanded`. A decorative icon has `aria-hidden`. Each `aria-label` of a toolbar control binds
  to a Transloco string.
- **Multilingual support at run time (EN and RU).** The app uses `@jsverse/transloco` with a scope for
  each feature that loads on demand. A language switcher with flag icons is in the toolbar, and the
  app keeps the selection in `localStorage`. The client translates a server error key through the
  shared `ErrorKeys` constant.
- **Interface density preference.** The Preferences section of the Profile page has an "Interface
  density" slider with the Material density levels 0 to 5. The app applies the level at run time
  through `data-ui-density` on `<html>` and keeps it in `localStorage` for each device. The browser
  zoom controls the full size, which is intentional.
- **Keyboard shortcuts.** `Ctrl+S` and `Cmd+S` save the active form. `?` and `Ctrl+/` open a
  contextual reference dialog of the shortcuts. The registration is a stack, thus a dialog overlay
  scopes the shortcuts automatically.
- A responsive SCSS architecture.
- Snackbar error notifications.
- Form validation with error messages. A reusable password strength indicator
  (`<app-password-strength>`) has a visual meter of 4 bars and an aria-live label. The register page,
  the profile page and the reset-password page show it.
- A 404 page and a 403 page.
- The toolbar shows the version and the git hash through a `MatTooltip`.
- **Collapsible side navigation.** The left panel is persistent, and it is 64 px narrow or 220 px
  wide. The app keeps the state in `localStorage` for each user. Below 599 px the panel becomes an
  overlay automatically, through `BreakpointObserver`. The hamburger button in the toolbar opens the
  drawer.

  The links come from a `NavLink` registry on `SidenavStateService`, which the app filters by
  permission. The root route goes to the first available navigation link, or to `/profile` as the
  fallback, through `defaultRoute()`.
- **A standard dialog system.** The `DialogSize` enum has the values `Confirm`, `Form` and `Wide`, and
  the `dialogSizeConfig()` helper applies them. Each dialog uses the responsive Material Design 3
  pattern `{ width: '90vw', maxWidth }`. The global `_dialogs.scss` file owns the title padding, the
  correction for Angular Material bug #26352 (a clipped floating label), and the `::before` spacer
  reset.

  **Adaptive confirm dialogs.** `AdaptiveDialogService.openConfirm()` opens a confirm dialog as a
  bottom sheet on a handset viewport, and as a standard dialog on a larger screen.

### Versioning

- The three workspaces share one version. Refer to `package.json`.
- `client/scripts/version.mjs` makes `src/environments/version.ts` automatically before each build,
  start and test.
- `npm run release`, from `client/`, increases the version in each `package.json` file. It makes
  `CHANGELOG.md` and a git tag.
- commitlint and the husky `commit-msg` hook enforce Conventional Commits.
- A bare `@name` in a commit subject becomes a GitHub user mention in `CHANGELOG.md` and on the
  release page. It gives credit to an unrelated account. Write a code identifier in backticks, for
  example `` `@Authorize` ``. commitlint rejects the bare form.
  `client/scripts/at-mentions.mjs` escapes a name that gets past the hook. It does this at the
  changelog generation (`postchangelog`) and again before the release body is published.

## Project Structure

```
fullstack-starter-app/
├── .github/workflows/      # CI/CD pipeline (GitHub Actions)
│   └── ci.yml              # Lint, test, build on push/PR to master
├── shared/                 # Shared types and constants (no build step)
│   ├── tsconfig.json       # Minimal config for IDE support
│   └── src/
│       ├── types/          # UserResponse, AdminUserResponse, AuthResponse, CursorPaginatedResponse<T>,
│       │                   # RoleResponse (public) / RoleAdminResponse (with isSystem/isSuper),
│       │                   # PermissionResponse, UserPermissionsResponse, etc.
│       ├── constants/      # PASSWORD_REGEX, cursor page size, SYSTEM_ROLES, MAX_CONCURRENT_SESSIONS,
│       │                   # ENTITLED/OPEN/CHANGEABLE_SUBSCRIPTION_STATUSES (one definition each), etc.
│       └── utils/          # feature-flag-evaluator (needs node:crypto, server + mock only),
│                           # feature-flag-attribute-value + feature-flag-timestamp (also imported by
│                           # the client, thus free of node built-ins), mongo-query-safety,
│                           # time (Temporal barrel), money (BigInt value object)
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
│   │   ├── dtos/           # CursorPaginationQueryDto, CursorPaginatedResponseDto<T>, EntityCursorQueryDto
│   │   ├── utils/          # escapeLikePattern, hashToken, withTransaction, extractAuditContext, cursor encode/decode, applyKeysetPagination
│   │   └── upload/         # createDiskStorageOptions() - reusable multer disk storage factory; validates extension + MIME type
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

Each seed entity has a UUID id. `mockId()` (`utils/mock-id.ts`) makes the id from a readable slug,
because the server guards each id path parameter with `ParseUUIDPipe`. `requireUuid()` mirrors that
guard on the mock routes. Thus a malformed id is a 400 in the two servers, before any lookup.

A spec and an E2E fixture address a seed row through `mockId('user-1')`, `mockId('role-editor')` and
similar calls. They do not use a literal id.

A request body obeys the same rule. The global `ValidationPipe` of the server runs before the handler.
Thus a body that fails its DTO is a 400, and the existence of the addressed row does not change this.

For that reason a mock handler runs its DTO-shape checks first. Those checks cover the type, the
length, the enum and the range. A check that needs the row stays below the 404. Such a check covers
the uniqueness, a state transition or a comparison with a remaining total.

A header is not a body. Thus the handler parses `If-Match` after the DTO-shape checks and above the
404. This gives a 428 for a valid body with no header, and a 400 for a bad body.

One helper can hold checks of the two classes. The rule-payload validator of a feature flag is an
example. Its `source` field tells which server layer rejects the same input. A `dto` failure is a 400
above the 404. A `service` failure is a 400 below the 404, because the server runs that validator
inside `replaceRules`, after the lookup.

The pipe also runs with `whitelist` and `forbidNonWhitelisted`. Thus a property that no DTO declares
is a 400 by itself.

`utils/validation.ts` mirrors the individual class-validator constraints. The mirrors are
`unknownPropertyErrors`, `stringErrors`, `trimmedStringErrors`, `stringArrayErrors`, `objectErrors`,
`intErrors`, `uuidErrors`, `iso8601Errors` and `oneOfErrors`. Take `stringErrors` for a field with no
`@Transform(trim)`, because a trim here accepts a value that the server rejects on length. Set the
`notEmpty` rule for a field with `@IsNotEmpty()`. That constraint counts only `''`, null and
undefined as empty. Thus a number fails `@IsString()` alone, and a whitespace-only value fails only
after a `@Transform(trim)` makes it empty. They use
the message text and the order of the true validator. That order puts the
unknown properties first, and then each property as the DTO declares it. Thus a handler composes its
DTO from them and answers with the envelope of the server.

Note that `@IsUUID()` on a body field is stricter than `ParseUUIDPipe` on a route parameter. It
constrains the version nibble and the variant nibble. Thus an id can be a valid path parameter and an
invalid body field.

The three workspaces import from the `@app/shared/*` path alias. Each workspace maps it to
`../shared/src/*` in its `tsconfig.json`.

## Prerequisites

- **Node.js 24**, which `.nvmrc` pins
- **PostgreSQL**, local or remote
- **npm**

## Getting Started

### 1. Clone the repository and install the dependencies

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

Then edit `.env`. Put your database credentials and your settings there.

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
| `JWT_SECRET` | - | HS256 secret, a minimum of 16 characters. It is necessary when `JWT_ALGORITHM=HS256` |
| `JWT_PRIVATE_KEY` | - | RSA private key PEM in base64. It is necessary when `JWT_ALGORITHM=RS256` |
| `JWT_PUBLIC_KEY` | - | RSA public key PEM in base64. It is necessary when `JWT_ALGORITHM=RS256` |
| `JWT_MIN_IAT` | - | A Unix timestamp. The server rejects a token that it issued before this value. Use it for key rotation |
| `JWT_EXPIRATION` | `3600` | Access token lifetime in seconds. The minimum is `120` |
| `JWT_REFRESH_EXPIRATION` | `604800` | Refresh token lifetime in seconds |
| `GOOGLE_CLIENT_ID` | - | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | - | Google OAuth client secret |
| `FACEBOOK_CLIENT_ID` | - | Facebook OAuth client ID |
| `FACEBOOK_CLIENT_SECRET` | - | Facebook OAuth client secret |
| `VK_CLIENT_ID` | - | VK OAuth client ID |
| `VK_CLIENT_SECRET` | - | VK OAuth client secret |
| `CLIENT_URL` | `http://localhost:4200` | Client URL for the OAuth redirects |
| `SMTP_HOST` | - | SMTP server host. A value enables the email delivery |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | - | SMTP username |
| `SMTP_PASS` | - | SMTP password |
| `REDIS_URL` | - | Redis connection URL. It is optional. It enables distributed rate limiting and a shared permission cache for a deployment with more than one instance |
| `TRUSTED_PROXIES` | - (local), `loopback,uniquelocal` (docker-compose) | The Express `trust proxy` setting. It is necessary behind nginx, Caddy, a K8s ingress or Cloudflare, thus `req.ip` gives the true client IP. The throttlers and the audit-log IP record use that value. It accepts `loopback`, `linklocal`, `uniquelocal`, an IP-CIDR list, a hop count, or `true`. The application has no built-in default. `docker-compose.yml` gives `loopback,uniquelocal` for a production deployment. Refer to "Deployment behind a reverse proxy" in `server/README.md` |
| `SWAGGER_ENABLED` | - | Set it to `true` to enable the Swagger UI in staging or in production. It is always on in `local` and `development` |
| `AUDIT_LOG_RETENTION_DAYS` | `90` | Days to keep an audit log entry |
| `DB_POOL_MAX` | `10` | Maximum size of the PostgreSQL connection pool |
| `DB_POOL_IDLE_TIMEOUT` | `30000` | Milliseconds before the pool closes an idle connection |
| `DB_POOL_CONNECTION_TIMEOUT` | `5000` | Milliseconds to wait for a connection before an error |
| `SMTP_FROM` | `noreply@example.com` | Default "from" address of an email |
| `ADMIN_EMAIL` | - | Email address of the initial administrator. The server seeds the account at startup, and it skips this step when the value is empty |
| `ADMIN_PASSWORD` | - | Password of the initial administrator |
| `ADMIN_FIRST_NAME` | `Admin` | First name of the initial administrator |
| `ADMIN_LAST_NAME` | `User` | Last name of the initial administrator |
| `TURNSTILE_SITE_KEY` | - | Public site key of Cloudflare Turnstile. The CAPTCHA on `/register` and `/forgot-password` stays disabled while one of the two keys is empty. Get a true pair at `dash.cloudflare.com`, then Turnstile, then Add site. It is free. The test keys (`1x00000000000000000000AA` and `1x0000000000000000000000000000000AA`) operate for local development and for CI. They are public and give no protection in production. Refer to [`server/README.md`, "Enabling CAPTCHA in production"](server/README.md#enabling-captcha-in-production) |
| `TURNSTILE_SECRET_KEY` | - | Secret key of Cloudflare Turnstile for the `siteverify` calls on the server. Use it with `TURNSTILE_SITE_KEY` |
| `PADDLE_API_KEY` | - | Paddle server API key. Use it with `PADDLE_WEBHOOK_SECRET`. The two values are necessary before Paddle counts as configured |
| `PADDLE_WEBHOOK_SECRET` | - | Paddle webhook HMAC secret for the signature verification |
| `PADDLE_ENVIRONMENT` | `sandbox` | Paddle API host: `sandbox` or `production` |
| `YOOKASSA_SHOP_ID` | - | YooKassa shop ID. Use it with `YOOKASSA_SECRET_KEY`. The two values are necessary before YooKassa counts as configured |
| `YOOKASSA_SECRET_KEY` | - | YooKassa secret key |
| `YOOKASSA_VAT_CODE` | `1` | VAT code on each 54-FZ receipt line. The range is 1 to 6, and the value depends on the tax regime. The value `1` means "no VAT" |
| `BILLING_DEFAULT_CURRENCY` | `USD` | Default billing currency of a new customer: `USD` or `RUB` |
| `BILLING_PROVIDER_TIMEOUT_MS` | `20000` | Deadline of one provider API call, in milliseconds. Neither provider SDK sets a transport timeout. Without this deadline, a stalled socket blocks the sequential renewal scan |
| `BILLING_WEBHOOK_IP_ALLOWLIST` | - (local), provider egress ranges (docker-compose) | IPs and CIDRs that can call the billing webhook receivers (`/api/v1/billing/webhooks/*`), separated by commas. Each other source gets a `403` before any webhook processing. An empty value disables the check. A malformed entry stops the startup. `docker-compose.yml` defaults it to the published egress ranges of Paddle and YooKassa. Refer to ["Billing webhook source-IP allowlist" in `server/README.md`](server/README.md#billing-webhook-source-ip-allowlist) |
| `BILLING_WEBHOOK_RETENTION_DAYS` | `90` | The age at which the daily retention sweep deletes a settled webhook delivery from the idempotency ledger. The sweep never deletes an unfinished delivery or a dead-lettered delivery |
| `BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS` | `7` | The age at which the sweep clears the stored event of a settled delivery, before it deletes the row. Keep this value below `BILLING_WEBHOOK_RETENTION_DAYS` |

### 3. Set up the database

```bash
cd server
npm run build
npm run migrations:run
npm run seed:run            # Optional: seed initial admin and RBAC data
```

`seed:run` is idempotent. Each seeder inserts only the rows that are missing. Thus a second run
against a database that already has the data does nothing. It does not give a unique-constraint
error.

### 4. Start the development servers

**Option 1: the full stack, that is the NestJS server with PostgreSQL.**

```bash
# Terminal 1 - Backend (port 3000)
cd server
npm run start:dev

# Terminal 2 - Frontend (port 4200, proxies /api to backend)
cd client
npm start
```

**Option 2: the mock server. It needs no database, and it is good for frontend development.**

```bash
# Terminal 1 - Mock backend (port 3000, in-memory data, watch mode)
cd mock-server
npm run start:dev

# Terminal 2 - Frontend (port 4200, proxies /api to mock server)
cd client
npm start
```

Then open http://localhost:4200 in your browser.

**Mock server credentials:**
- Administrator: `admin@example.com` / `Password1`
- User: `user@example.com` / `Password1`

## Docker Deployment

The project has a Dockerfile for each image and a Compose file for a production deployment.

### Build and run

```bash
# Build all images
docker-compose build

# Start all services (PostgreSQL, server, client)
docker-compose up -d
```

Services:

- **redis** is redis:7.4-alpine. It supplies the distributed rate limiting and the shared permission
  cache.
- **db** is postgres:18-alpine with a persistent named volume.
- **server** is the NestJS API on port 3000. Its entrypoint runs the migrations, does the optional
  administrator seed, and then starts the server. It exposes `GET /metrics` for Prometheus. It joins
  the `default` network and the external `shared` network, thus a Caddy instance on the host reaches
  it as `server:3000`.
- **client** is the Angular SPA. nginx serves it on port 8080. The host binding is
  `127.0.0.1:4200:8080`, thus only the localhost reaches it, and Caddy uses `client:8080` internally.
  The build uses `--base-href /nexus/`, and `docker build --build-arg BASE_HREF=/` changes it. The
  service joins the `default` network and the external `shared` network. The compose file declares
  `shared`, and no person attaches it manually. Thus the proxy stays reachable after a recreate of a
  container.
- **prometheus** is prom/prometheus:v3.12.0. It is on the internal network only and exposes no port.
  It scrapes `/metrics` each 15 s and keeps the data 30 days. Its configuration is
  `monitoring/prometheus.yml`.
- **grafana** is grafana/grafana:13.0.1 on port 3001. The stack provisions the Prometheus datasource
  and the **App Metrics** dashboard.

  That dashboard shows the HTTP traffic, the p95 latency of each route, the authentication events, the
  SSE connections and the Node.js runtime. It has an RBAC and Reliability section, with the permission
  denials, the process RSS, the token-reuse alarm, the uptime, and the queue and handle health. It has
  a Mail Queue section, with the BullMQ depth by state and the counts of the failed and completed
  jobs. It has a Database section, with the depth of the connection pool by state. It has a Cache
  section, with the hit ratio of each Redis-backed RBAC cache and feature-flag cache.

  Refer to [`server/README.md`, "Observability"](server/README.md#observability). That section has the
  full metric list, the Prometheus alert recipes for `rbac_permission_denied_total`, and an RBAC
  drill-down dashboard (`doc/grafana/rbac.json`).

  Grafana-managed alerting comes from the files in `monitoring/grafana/provisioning/alerting/`. Refer
  to [Alerting](#alerting) below.

### Alerting

`/health/ready` intentionally stays `ok` when a non-fatal dependency degrades. Two examples are a
failed SMTP verify and a production instance with no `REDIS_URL`. Thus neither the container
healthcheck nor the deploy gate sees the condition.

The `dependency_up` gauge is the signal that does see it. Each readiness indicator writes its result
onto the gauge: `1` is healthy, and `0` is degraded or down. There is one series for each dependency.

Two Grafana-managed rules watch the gauge. They come from files, thus the UI shows them as read-only
with `provenance: file`:

| Rule | Expression | `for` | No-data behaviour |
|---|---|---|---|
| Dependency degraded | `dependency_up < 1` | 10m | `OK`. A missing series means that the server is down, and the rule below owns that condition |
| Server unreachable | `up{job="nestjs-server"} < 1` | 5m | `Alerting` |

The window of 10 minutes is intentional. `SmtpHealthIndicator` keeps its verify result for 5 minutes.
Thus a sample can be one TTL old, and a shorter window alerts on a dependency that already recovered.
The worst-case detection latency is therefore approximately 15 minutes. Before this rule existed, a
dead SMTP server stayed unknown for five and a half weeks.

The delivery goes to one webhook contact point, `ops-webhook`. It reads `$ALERT_WEBHOOK_URL`.

The root notification policy also comes from a file, and it is not optional. Without it, Grafana
continues to route to its built-in email contact point. Grafana would then try to deliver the message
"mail is down" by mail.

**To set up the receiver:** make a webhook endpoint that accepts a `POST` with a JSON body. An n8n
*Webhook* node with the method `POST` and "Respond immediately" is sufficient. Then store its URL as
the `ALERT_WEBHOOK_URL` repository secret.

The two deploy workflows stop while that secret is empty. Grafana refuses to start with an empty
webhook URL, and it would stop the monitoring stack.

The payload has the Alertmanager shape. It holds `status`,
`alerts[].labels.{alertname,dependency,severity}` and
`alerts[].annotations.{summary,description}`. Do the routing on `severity` (`warning` or `critical`)
or on `dependency` in the receiver, and not in Grafana.

### Resource limits

Each service declares a conservative `mem_limit` as defense in depth. Thus one container with a leak
or a runaway process cannot take the memory of the others.

Each cap comes from the memory profile of its own service. Each cap is above the measured peak working
set of the container, and the startup spike and the migration spike are included. The caps are not
the steady-state value. Thus they hold on each host that runs the stack.

| Service | `mem_limit` | `mem_reservation` |
|---|---|---|
| server | 384m | 128m |
| db | 256m | 96m |
| grafana | 384m | 192m |
| prometheus | 192m | - |
| redis | 96m | - |
| client | 64m | - |

A limit is a ceiling and not a reservation. Thus the sum of the limits can be more than the available
RAM. The container swap stays at the default, because the compose file sets no `memswap_limit`. Thus a
container can spill to swap before the kernel stops a process with an OOM kill.

### Container hardening

Each service runs with `security_opt: no-new-privileges:true` and `cap_drop: ALL`.

The official entrypoints of two images start as root and drop the privileges with `gosu`. Those two
images keep only the minimal capabilities for that drop. `redis` keeps `SETUID` and `SETGID`. `db`
keeps `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `SETGID` and `SETUID`, for initdb, for chown and for the
privilege drop.

`server`, `client`, `prometheus` and `grafana` already run as a non-root user on a high port. They
need no capability.

Each service also declares a `healthcheck`. Thus `restart: unless-stopped` recovers a container that
runs but does not answer, and not only a container that stopped. `prometheus` uses `/-/healthy` and
`grafana` uses `/api/health`. They join the existing checks on db, redis, server and client.

### Docker environment variables

Set these variables in `server/.env`, beside the standard server variables. They make an initial
administrator account at the first startup:

```
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=YourSecurePass1
ADMIN_FIRST_NAME=Admin
ADMIN_LAST_NAME=User
```

The administrator seeder is idempotent. It skips the creation when the user already exists. It does
nothing when `ADMIN_EMAIL` is empty.

Set `GRAFANA_ADMIN_PASSWORD` as a shell environment variable before you run `docker-compose up`. It
controls the Grafana administrator password. The default is `admin`, and it is for local use only.
Grafana is at http://your-host:3001.

In production that default never applies. The `deploy.yml` and `rebuild.yml` workflows stop before
they touch a container when the `GRAFANA_ADMIN_PASSWORD` secret is empty. Thus a cleared secret fails
the deploy loudly, and it does not ship `admin`/`admin` silently.

### Deploy pipeline

`.github/workflows/deploy.yml` starts manually (`workflow_dispatch`) or on a push to `master`. It
builds the Docker images locally and scans them with Trivy for HIGH and CRITICAL findings. It pushes
to GHCR only after the two scans pass. Then it deploys to the VPS with health checks and an automatic
rollback.

`.github/workflows/rebuild.yml` is a weekly rebuild on Sunday at 03:00 UTC. It collects the OS
security patches. It rebuilds the images with `no-cache`, scans them and deploys them. It also
snapshots the current images as `:pre-rebuild` for a safe rollback.

On a HIGH or CRITICAL finding, the rebuild workflow calls `scripts/auto-patch-cves.sh`. That script
upgrades the vulnerable Alpine packages, with the stable repositories first and edge as the fallback.
It does this through a `CVE_PATCHES` block in the Dockerfile. Then it scans again and opens a patch
PR.

If the script cannot resolve a CVE, it opens a tracking issue with the label
`auto-patch-blocked`. The issue holds the `apk` resolver conflict. One example of such a condition is
a fix that conflicts with a pinned sibling package. The deploy stays blocked until a person acts.

`.github/workflows/edge-patch-cleanup.yml` is a quarterly check. It makes a PR that removes the
`CVE_PATCHES` blocks from the Dockerfiles when the base image already has the fixes.

The two paths above open their pull request with `GITHUB_TOKEN`. GitHub does not start a workflow run
for an event that this token raises. Thus those PRs arrive with no CI behind them.

For that reason the body of each PR starts with a necessary first action: close the pull request and
open it again. That is an event from a person, and it starts the full suite. Do not merge one of those
PRs until the checks are green, because the two change the Dockerfiles that build the production
images.

`.github/actions/preseed-ssh-client` is a local composite action. It installs the `drone-ssh` client
that `appleboy/ssh-action` uses, before that action runs.

`appleboy/ssh-action` downloads its worker binary from a GitHub release at each invocation. It stops
the job when that URL is not available. That is how a deploy failed after six sequential 503 answers.

The composite action restores the binary from the Actions cache, compares it with a pinned sha256, and
installs it where the action looks for it. Thus the action skips its own download.

Two properties follow. In the steady state a deploy contacts no third-party release URL. Also, a
digest pins the executable that runs with the SSH key of the VPS, and the workflow does not trust the
file on arrival.

The pinned version and the checksum are in that one file. Change the two together, and take the value
from the `checksums.txt` file of the release.

Each workflow that opens an SSH session to the VPS uses the composite action. Those workflows are
`deploy.yml`, `rollback.yml`, `rebuild.yml` and `rotate-keys.yml`.

The same action also computes the SHA256 fingerprint of the `VPS_HOST_KEY` secret and gives it as an
output. Each of the four workflows passes that output to the `fingerprint` input of the SSH action.

That fingerprint is what makes the client verify *which* host it authenticates to. With no fingerprint
the client accepts the key of whichever host answers. A runner starts each run with an empty
`known_hosts` file. Thus the first-use trust gap opens again at each deploy, with the deploy key and
21 other secrets on the other side of it.

The derivation lives in the composite action, thus it is in one place and not in four. An empty secret
fails the step, and it does not restore the unverified behavior silently.

The `resolve` job of `rollback.yml` does not check out the repository. Thus it writes
`~/.ssh/known_hosts` from the same secret itself, and it connects with `StrictHostKeyChecking=yes`.

`.github/dependabot.yml` keeps the `@sha256` base-image digests in `server/Dockerfile` and
`client/Dockerfile` current. It uses the docker ecosystem each week, and it ignores a major bump of
`node` and of `nginx`. Thus a build is reproducible and still gets reviewed upstream base updates.

The two deploy paths refresh the checkout on the host with `git pull --ff-only`. Then they check out
`docker-compose.yml` at the commit of the images that they deploy. Thus a merge that lands during a
deploy cannot pair a newer compose file with older images. `rollback.yml` does the same for its own
target SHA. The next run restores the file before it pulls.

Each workflow that touches the VPS shares the `deploy-production` concurrency group, thus there is no
race condition. `rollback.yml` is the one member with `cancel-in-progress: true`. Thus an emergency
rollback stops whichever run holds the group, and it does not wait behind it. Without that setting, a
wedged deploy blocks the rollback that must undo it.

Each job that opens an SSH session also has a `timeout-minutes` value. A person observed that the
connect timeout and the command timeout of the SSH action do not always end a session against a host
that does not answer.

### Production credentials and secrets

**Model.** Each production secret is a **GitHub repository secret**, and that is the single source of
truth.

On each `deploy.yml` and `rebuild.yml` run, after the `git pull`, `scripts/sync-prod-env.sh` writes
the secrets into the VPS file `server/.env`. It also writes `DB_PASSWORD` into the root `.env` file.
Thus the env files on disk are a **derived artifact**. A rebuild of the VPS from nothing restores the
credentials, and it does not drop the email, authentication or DB access silently.

The script writes a key **only when its secret is not empty**. An unset secret leaves the value on
disk unchanged. Thus it is safe to add a key before a person fills its secret. The script never
touches a key that is not in its list, for example `JWT_MIN_IAT`, `JWT_ALGORITHM` and the non-secret
configuration.

**How `scripts/sync-prod-env.sh` operates.** The deploy workflow exports the managed keys as
environment variables, from `${{ secrets.* }}`. Then it runs the script from the checkout root on the
VPS. For each managed key the script calls an `upsert KEY VALUE FILE` helper. That helper does three
things:

1. **It skips an empty value.** If the secret is unset or empty, the key on disk stays exactly as it
   is. For that reason it is safe to add a new managed key before its secret exists.
2. **It replaces the line or appends it.** It removes an existing `KEY=` line and writes a new
   `KEY=value` line. Thus there is never a duplicate line, and the value updates in place.
3. **It writes atomically.** It builds a temporary file and moves it over the target. Thus a crash in
   the middle of a write cannot leave a half-written env file.

The script targets `server/.env` for each managed key. It also mirrors `DB_PASSWORD` into the root
`.env` file, which the `db` postgres service reads. Then it sets the mode of the two files to `600`.

The script touches only the keys in its own list. It keeps each other line of `server/.env` byte for
byte, including the non-secret configuration, `JWT_MIN_IAT` and each comment. The header comment of
the script is the authoritative reference for the key list.

**Secret inventory:**

| GitHub secret | Used by | Injected into | Notes |
|---|---|---|---|
| `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` | all VPS workflows | - (SSH auth) | How Actions reaches the VPS |
| `VPS_HOST_KEY` | all VPS workflows | - (SSH host verification) | The public key of the VPS host, as one line in the `ssh-keyscan` output format. Each SSH job verifies the far side against it before it authenticates. Thus a redirected connection cannot collect the deploy key and the secrets with it. **An empty value fails the job by design**, because the SSH client skips the verification silently when it has no key to compare against. **The value must be the ECDSA key of the host.** The host answers with the host key that the client asks for. The Go client inside `drone-ssh` prefers `ecdsa-sha2-nistp256`. Thus an `ssh-ed25519` value fails each job with `host key fingerprint mismatch`. Local OpenSSH prefers ed25519 and verifies against such a value without an error, thus the incorrect key looks correct. Take the key again if a person reinstalls the host: run `ssh-keyscan -t ecdsa <host>` and compare it with `/etc/ssh/ssh_host_ecdsa_key.pub`, read on the host itself. A reboot or a resize keeps the same key. |
| `GITHUB_TOKEN` | all | - (GHCR login) | Actions supplies it automatically |
| `GRAFANA_ADMIN_PASSWORD`, `GRAFANA_ROOT_URL` | deploy, rebuild | `docker-compose.yml` `${}` | Environment of the Grafana container. An empty `GRAFANA_ADMIN_PASSWORD` stops the deploy, thus production gets no silent `admin` default. |
| `ALERT_WEBHOOK_URL` | deploy, rebuild | root `.env`, then `docker-compose.yml` `${}` | The address to which Grafana POSTs a firing alert. An empty value stops the deploy, because Grafana exits at startup when a provisioned webhook has no URL. Treat the URL as a capability: a person who can POST to it can inject false alerts. |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | deploy, rebuild, rotate-keys | `server/.env` | The RS256 keypair, as base64 PEM |
| `DB_PASSWORD` | deploy, rebuild | `server/.env` and root `.env` | It must be equal to the password of the postgres volume. Refer to the caution below |
| `GOOGLE_CLIENT_SECRET`, `FACEBOOK_CLIENT_SECRET`, `VK_CLIENT_SECRET` | deploy, rebuild | `server/.env` | The OAuth client secrets |
| `ADMIN_PASSWORD` | deploy, rebuild | `server/.env` | The password of the initial administrator |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | deploy, rebuild | `server/.env` | Outgoing email |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | deploy, rebuild | `server/.env` | The Cloudflare Turnstile CAPTCHA on `/register` and `/forgot-password`. The site key is public, but the workflow injects it in the same way for safety during a rebuild. The CAPTCHA stays disabled while one of the two is empty. Refer to [Enabling CAPTCHA in production](server/README.md#enabling-captcha-in-production) |
| `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` | deploy, rebuild | `server/.env` | The credentials of the billing providers. Billing stays hidden until the full pair of a provider has a value. Keep them empty until a person connects a provider |
| `CI_JWT_SECRET` | ci.yml | - (CI tests only) | Production does not use it |

> **Caution about `DB_PASSWORD`.** Postgres writes the password into its data volume at the first
> initialization. A change of the `DB_PASSWORD` secret does **not** change the key of an existing
> volume, and the application then cannot connect. Keep the secret equal to the live password. To
> rotate it truly, change it inside postgres too.

**Hand-maintained values, which are not secrets.** Set these directly in the VPS file `server/.env`.
They are the non-secret configuration: `CLIENT_URL`, `CORS_ORIGINS`, `TRUSTED_PROXIES`, the OAuth
client **IDs** such as `GOOGLE_CLIENT_ID`, `ADMIN_EMAIL`, `JWT_ALGORITHM`, `JWT_MIN_IAT` (which
`rotate-keys.yml` sets), `BILLING_DEFAULT_CURRENCY`, and the DB pool and logging settings.

**Checklist to provision a VPS from nothing:**

1. Install Docker and Compose. Make the `deploy` user and the directory `/home/deploy/nexus`. Clone
   the repository there.
2. Make sure that the `shared-network` Docker network exists. Make sure that Caddy routes `/api` to
   `server` and `/nexus` to `client`.
3. Fill each GitHub secret in the inventory above.
4. Make `server/.env` from `server/.env.example`. Fill the **hand-maintained** non-secret keys. Leave
   the secret-managed keys empty, because the deploy injects them.
5. Make the root `.env` from `.env.example`, with `DB_NAME`, `DB_USER` and the image names. Leave
   `DB_PASSWORD` empty, because the deploy injects it.
6. Start `deploy.yml` with `workflow_dispatch`. The sync script fills the secret-managed keys. The
   stack starts, and `/api/health/ready` reports `database/redis/smtp: up`.

---

## API Documentation

The Swagger documentation is at http://localhost:3000/swagger. It is available while the server runs
in the `local` or `development` environment. To enable it in another environment, set
`SWAGGER_ENABLED=true`.

The base URL of the API is `/api/v1`.

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | None | Register a new user |
| POST | `/auth/login` | None | Log in. Sets the `refresh_token` HttpOnly cookie and returns an access token |
| POST | `/auth/refresh-token` | None | Refresh the access token. Reads the `refresh_token` cookie and rotates it |
| POST | `/auth/logout` | Bearer | Log out. Revokes the refresh tokens |
| GET | `/auth/profile` | Bearer | Get the profile of the current user |
| PATCH | `/auth/profile` | Bearer | Update your own profile: the name and the password. `currentPassword` is necessary for a password change. A user with OAuth only can omit it |
| POST | `/auth/profile/email/initiate` | Bearer | Start a self-service email change. Throttled to 3 calls each hour. Requires the current password. Rejects an account with OAuth only |
| POST | `/auth/profile/email/confirm` | None | Confirm an email change with the token from the new address. Applies the change in a transaction and revokes each session |
| GET | `/auth/oauth/:provider` | None | Start an OAuth login. The providers are google, facebook and vk |
| GET | `/auth/oauth/:provider/callback` | None | Callback of the OAuth provider |
| POST | `/auth/verify-email` | None | Verify an email address with a token |
| POST | `/auth/resend-verification` | None | Send the verification email again |
| POST | `/auth/forgot-password` | None | Request a password reset email. A CAPTCHA token is necessary near the rate limit |
| GET | `/auth/captcha-config` | None | Public CAPTCHA configuration: the site key and the enabled flag |
| POST | `/auth/reset-password` | None | Reset the password with a token |
| POST | `/auth/oauth/link-init` | Bearer | Start an OAuth account link. Sets a cookie with a short life, thus the next OAuth flow attaches the provider to the current user |
| POST | `/auth/oauth/exchange` | None | Exchange the OAuth-data cookie from the callback for the auth response: an access token and a refresh cookie |
| GET | `/auth/oauth/accounts` | Bearer | List the linked OAuth accounts |
| DELETE | `/auth/oauth/accounts/:provider` | Bearer | Unlink an OAuth provider |
| GET | `/auth/permissions` | Bearer | Get the resolved permissions of the current user |
| GET | `/users/cursor` | `users:search` | List the users with cursor (keyset) pagination. `includeDeleted=true` adds the soft-deleted rows |
| GET | `/users/search/cursor` | `users:search` | Search the users with cursor pagination. The filters are `q` (a substring across the id, email, firstName and lastName), `email`, `firstName`, `lastName`, `role` (an exact role name) and `isActive`. `includeDeleted=true` adds the soft-deleted rows. A string filter has a cap of 255 characters. A boolean filter accepts `true` or `false` only, and each other value is a 400 |
| GET | `/users/:id` | `users:read` | Get a user by ID |
| GET | `/users/:id/permissions` | `users:read` | Get the effective permissions: the roles, the resolved permissions and the packed CASL rules |
| POST | `/users` | `users:create` | Create a user |
| PATCH | `/users/:id` | `users:update` | Update a user: the email, the name, the password, `isActive` to deactivate or reactivate, and `unlockAccount`. A password change or an email change revokes the sessions of the target |
| DELETE | `/users/:id` | `users:delete` | Soft-delete a user. Sets `deleted_at` and revokes the sessions |
| POST | `/users/:id/restore` | `users:delete` | Restore a soft-deleted user. Clears `deleted_at` and does not change `isActive` |
| POST | `/roles` | `roles:create` | Create a role |
| GET | `/roles` | `roles:read` | List the roles with their permissions |
| GET | `/roles/:id` | `roles:read` | Get a role by ID |
| PATCH | `/roles/:id` | `roles:update` | Update a role |
| DELETE | `/roles/:id` | `roles:delete` | Delete a role |
| GET | `/roles/permissions` | `roles:read` | List each available permission |
| GET | `/roles/:id/permissions` | `roles:read` | Get the permissions of one role |
| PUT | `/roles/:id/permissions` | `roles:update` | Replace the full permission set of a role |
| POST | `/roles/:id/permissions` | `roles:update` | Assign permissions to a role |
| DELETE | `/roles/:id/permissions/:permId` | `roles:update` | Remove a permission from a role |
| POST | `/roles/assign/:userId` | `roles:assign` | Assign a role to a user. Answers 404 when the user is unknown or soft-deleted |
| DELETE | `/roles/assign/:userId/:roleId` | `roles:assign` | Remove a role from a user. Answers 404 when the user is unknown or soft-deleted |
| GET | `/notifications/stream` | Bearer | The SSE stream. It pushes `session_invalidated`, `permissions_updated` and `user_crud_events`. The last one goes only to a client with `users:search` |
| GET | `/rbac/metadata` | `permissions:read` | Get the RBAC metadata: the resources and the actions. Redis caches it for 60 s |
| GET | `/rbac/resources` | `permissions:read` | List each resource |
| PATCH | `/rbac/resources/:id` | `permissions:update` | Update the display data of a resource |
| POST | `/rbac/resources/:id/restore` | `permissions:update` | Restore an orphaned resource. Answers 400 when no controller registers it |
| GET | `/rbac/actions` | `permissions:read` | List each action |
| POST | `/rbac/actions` | `permissions:create` | Create a new action |
| PATCH | `/rbac/actions/:id` | `permissions:update` | Update an action |
| DELETE | `/rbac/actions/:id` | `permissions:delete` | Delete a custom action |
| GET | `/feature-flags` | None (optional) | Evaluate the flag set for the caller. An authenticated caller gets the flags that resolve true plus the `public` flags. An anonymous caller gets the `public: true` flags only |
| GET | `/admin/feature-flags` | `feature-flags:manage` | List each feature flag |
| GET | `/admin/feature-flags/:id` | `feature-flags:manage` | Get a feature flag by ID |
| GET | `/admin/feature-flags/attribute-keys` | `feature-flags:manage` | List the `custom` attribute keys that a rule payload can reference. A reference load, not a list |
| POST | `/admin/feature-flags` | `feature-flags:manage` | Create a feature flag |
| PATCH | `/admin/feature-flags/:id` | `feature-flags:manage` | Update a feature flag. Uses optimistic locking through `If-Match` |
| DELETE | `/admin/feature-flags/:id` | `feature-flags:manage` | Delete a feature flag |
| PUT | `/admin/feature-flags/:id/rules` | `feature-flags:manage` | Replace the targeting rules of a flag |
| POST | `/admin/feature-flags/:id/preview` | `feature-flags:manage` | Show how a flag evaluates for given attributes, and save nothing. The body can carry an unsaved `rules`, `enabled` and `environments` set, which the server evaluates in place of the stored flag |
| POST | `/admin/feature-flags/:id/toggle` | `feature-flags:manage` | Enable or disable a flag |

## Available Commands

> `format` and `format:check` cover each TypeScript file and each ESM file that the workspace owns.
> They do not cover `src/` only. They include the root-level configuration files, such as
> `eslint.config.*`, `playwright.config.ts` and `proxy.conf.mjs`, and they include `scripts/`. The
> `shared/` module and the root-level `*.mjs` configuration files are formatted from `server/`,
> because they belong to no single workspace.

> `typecheck` exists in the three workspaces, and it is not redundant with `build`. `build` typechecks
> only the files that it compiles. The `tsconfig.build.json` file of `server/` excludes `test/`,
> `*.spec.ts` and `common/testing/`. The `ng build` command of the client covers the `app` project
> only, and Playwright transpiles the tests without a typecheck. Thus no other gate examines `e2e/`.
>
> Each script runs the true project configurations, and never the base `tsconfig.json`. The base
> configuration of the client is not a compilable program by itself: `e2e/` needs `types: ["node"]`
> and ESNext modules, the specs need `lib: esnext.disposable`, and the app project needs `types: []`.
> Run the script in each affected workspace before you push.

> The client splits the gate in two: `typecheck` for the app and spec projects, and `typecheck:e2e`
> for the e2e project and `playwright.config.ts`. They are separate because the `e2e/` fixtures import
> mock-server sources. Thus the e2e project typechecks only where that workspace is installed, that is
> on a local machine and in the `Client E2E` CI job. Run the two before you push a client change.

### Mock Server (`cd mock-server`)

```bash
npm start                  # Start mock server (port 3000)
npm run start:dev          # Start with watch mode (ts-node-dev)
npm run typecheck          # tsc --noEmit (no build script - this is the type gate)
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

- **Standalone components.** No component uses an NgModule, and each component uses `OnPush` change
  detection.
- **Loading on demand.** Each route uses `loadComponent`.
- **NgRx Signal Store** manages the state. `AuthStore` is global, and `UsersStore` is at route level.
- **HTTP interceptors.** The JWT interceptor attaches the token and handles a 401 refresh. The error
  interceptor shows the snackbar notifications.
- **Guards.** `authGuard` checks the authentication and refreshes the token. `permissionGuard(action,
  subject)` does a typed CASL check for a route. `adminPanelGuard` does an OR check on search/User,
  read/Role and read/Permission. `guestGuard` sends an authenticated user away. On the server,
  `PermissionsGuard` checks the RBAC permissions.
- **Path aliases.** They are `@core/*`, `@features/*` and `@shared/*`.

### Server

- A **modular NestJS architecture** with a dynamic root `CoreModule`.
- **Passport strategies.** `LocalStrategy` uses the email and the password. `JwtStrategy` uses the
  Bearer token. It verifies the signature and `tokenRevokedAt`, and it extracts
  `{ userId, email, roles }`. `GoogleStrategy`, `FacebookStrategy` and `VkStrategy` do the OAuth
  logins, and the module registers them conditionally.
- **Routing is secure by default.** `APP_GUARD` registers `JwtAuthGuard` globally. Each endpoint
  requires a valid Bearer token, and `@Public()` is the only exception. The `check-auth-coverage` e2e
  suite reads the per-feature route manifests in `contracts/routes/`. Thus no protected endpoint can
  become unauthenticated by accident.
- **RBAC.** `RolesModule` supplies `PermissionsGuard`, `PolicyEvaluatorService`, `PermissionService`
  and `CaslAbilityFactory`. The typed tuple `@Authorize(['action', 'Subject'])` replaces
  `@UseGuards(JwtAuthGuard, RolesGuard) @Roles()` on each protected endpoint.
- **Request pipeline.** The order is: global middleware, module middleware, guards, interceptors,
  pipes, controller.
- **Pagination.** Each list endpoint is cursor-paginated, through `CursorPaginationQueryDto` and
  `CursorPaginatedResponseDto<T>`. Offset pagination does not exist in this repository.
- **Cron jobs.** One job cleans up the expired tokens each day. One job cleans up the revoked tokens
  each week.
- **Swagger** makes the API documentation automatically.

### Database

TypeORM migrations manage 24 tables. The core tables are below. The billing tables are in
[`doc/billing-design.md`](doc/billing-design.md), section 3.

- **users** has a UUID primary key, a unique email address, a name, and a bcrypt password hash. The
  hash is nullable for a user with OAuth only. The row also holds the role and active flags, the email
  verification data (`isEmailVerified`, the token and `expiresAt`), the preferred `locale` for the
  email language with the default `en`, the account lockout data (`failedLoginAttempts` and
  `lockedUntil`), the password reset data (the token and `expiresAt`), and the soft delete column
  (`deleted_at TIMESTAMPTZ NULL`). It has a ManyToMany relation to the roles through `user_roles`.
- **oauth_accounts** links to a user with a CASCADE delete. It holds the provider, the unique
  provider_id and the timestamps.
- **refresh_tokens** links to a user with a CASCADE delete. It holds the token string as a SHA-256
  hash, the expiry and the revoked flag.
- **roles** has a UUID primary key, a unique name, a description, an `isSystem` flag and an `isSuper`
  flag. It has a ManyToMany relation to the users.
- **resources** has a UUID primary key, a unique name, a `displayName`, a description and an
  `isSystem` flag. The `is_orphaned` boolean is true when a person removed the controller. The
  permissions of an orphaned resource then give nothing, and a deny rule continues to apply until a
  person restores it. `allowed_action_names text[]` holds the permitted actions, and `null` means the
  full set of default actions.
- **actions** has a UUID primary key, a unique name, a `displayName`, a description, an `isSystem`
  flag and a `sortOrder`.
- **permissions** has a UUID primary key, a `resource_id` and an `action_id`. The pair is unique, and
  the two columns are foreign keys to the resources and the actions.
- **role_permissions** has a foreign key to the roles and a foreign key to the permissions. It has an
  optional jsonb `conditions` column.
- **user_roles** is a join table of `user_id` and `role_id`, with a composite primary key.
- **audit_logs** holds the security-sensitive operations. Each row has the actor, the target, the IP
  address and the request id.
- **feature_flags** has a UUID primary key, a unique key, a description, the `enabled` flag, the
  `environments text[]` column with a GIN index, the `public` flag, an integer `version`, an
  `updated_by_user_id` and the timestamps.
- **feature_flag_rules** has a UUID primary key, a `flag_id` foreign key with CASCADE and a btree
  index, a priority, a type, an effect, a `jsonb` payload and the timestamps.
- **feature** has an auto-increment ID, a name and the timestamps.

## Code Quality

| Tool | Scope | Config |
|------|-------|--------|
| ESLint | Client (angular-eslint, unused-imports, import cycles) | `eslint.config.mjs` |
| ESLint | Server (@typescript-eslint + prettier, import cycles) | `eslint.config.ts` |
| ESLint | Mock server (@typescript-eslint + prettier, import cycles) | `eslint.config.ts` |
| - | The three configurations need `settings['import/parsers']` to map `.ts` to `@typescript-eslint/parser`. Without that map, `import/no-cycle` passes on everything silently | - |
| ESLint | Shared rules for the workspaces. They include a `no-restricted-syntax` ban on an `as unknown as T` double cast. The client configuration adds two selectors: one bans the `'admin'` role literal, and one bans the rendering of a server `errorKey` outside `parseHttpErrorMessage` | `eslint.base.config.mjs`, `client/eslint.config.mjs` |
| Prettier | All workspaces (single quotes, no trailing commas) | `.prettierrc` |
| Stylelint | Client SCSS (recess property order, no `px` unit outside a breakpoint) | `.stylelintrc.json` |
| Husky + lint-staged | Pre-commit hook (auto-fix the staged files) | `.lintstagedrc.mjs` |
| Commitlint | Conventional Commits enforcement | `client/commitlint.config.mjs` |
| commit-and-tag-version | Automated versioning and CHANGELOG | `client/.versionrc.json` |
| check-imports | Repo-wide cycles and barrel rules (all four source roots) | `scripts/check-imports.mjs` |

### Import hygiene and barrels

`npm run check:imports` is available from each of the three workspaces. It walks the whole repository,
thus one run covers everything. It enforces four rules:

1. **A dependency cycle is an error.** A TypeORM entity file is exempt. A bidirectional relation needs
   the related class as a value inside an arrow function that runs later. Thus `import type` is not
   available, and the cycle belongs to the ORM. A cycle in which each edge is an `import type` is also
   exempt, because the compiler erases those edges.
2. **A file must not import through a barrel in its own directory.** Import the sibling module
   directly. This one pattern is what changes a barrel from a facade into a cycle.
3. **A new barrel is an error.** Four barrels are grandfathered in `ALLOWED_BARRELS`:
   `shared/src/types` and `shared/src/constants`, which are the cross-workspace public API of a
   package that the three workspaces consume, plus `server/src/common/dtos` and
   `server/src/modules/core/filters`.
4. **A directory that has a barrel is entered through it.** Use no deep path from outside. Write
   `from '@app/shared/types'`, and never `from '@app/shared/types/role.types'`.

   Rule 2 and rule 4 are one principle from two sides. A barrel is the outside face of a directory,
   and never its inside face.

   **A file inside `shared/src/` is exempt and must keep its deep paths.** A path through the barrels
   closes a cycle: `types/index.ts` re-exports `feature-flag.types`, which imports
   `../constants/feature-flag.constants`. At the same time, `constants/index.ts` re-exports
   `billing-flags.constants`, which imports `../types/billing.types`. `PACKAGE_API_ROOTS` in the script
   holds that exemption.

**To import from `shared/`, always use the barrel.** Write `from '@app/shared/constants'`, and never
`from '@app/shared/constants/auth.constants'`.

The two styles were both in use. The barrel won for two reasons. It makes `constants` consistent with
`types`. Also, the counter-argument was empty: the client bundle measures 846.90 kB raw with the deep
imports and 846.83 kB with the barrel, thus tree-shaking loses nothing.

A symbol that you can reach only by a deep path is a barrel that needs the export. It is not a deep
import to write.

This was a convention only, until rule 4 was added. By that time, 25 sites had moved away from it.
`shared/src/utils/` and `shared/src/enums/` have no barrel, and a full path still imports from them.
Rule 4 says nothing about a directory with no barrel.

The check is written in Node with no dependency, and it is not an ESLint rule. ESLint cannot lint a
file outside the directory that holds its configuration. Thus **no workspace lints `shared/`**, and
that is exactly where the two largest barrels are.

The script carries a `--self-test` option. That option builds synthetic fixtures and fails if a
detector stops working. CI runs the self-test before the check itself.

`import/no-cycle` also runs in the three workspaces. Thus a cycle appears in the editor while a person
writes it, and not later in CI. That rule is the fast feedback loop. `check-imports.mjs` is the
enforcement, and it is the only one of the two that sees `shared/`. `server/` and `mock-server/`
exempt `**/*.entity.ts` for the TypeORM reason above, thus they agree with the script.

> **Do you change one of the two cycle rules?** Prove that it still detects a cycle. Write a
> throwaway two-file cycle in the `src/` directory of that workspace. Confirm that ESLint reports it.
> Then delete the two files. A green lint run is not evidence. The failure mode of this rule is
> silence, and for that reason the rule was inactive in the client for a long time.

### Git Hooks

A pre-commit hook, through [husky](https://typicode.github.io/husky/), runs **lint-staged** at each
commit. It applies auto-fix linting to the staged files only:

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

A commit-msg hook (`client/.husky/commit-msg`) also runs **commitlint**. It enforces the
[Conventional Commits](https://www.conventionalcommits.org/) format. It also rejects a bare `@name`
mention in the subject or in the body. Refer to [Versioning](#versioning).

husky, lint-staged and commitlint are in the `client/` sub-package. An `npm install` inside `client/`
activates the git hooks through the `prepare` script.

## Testing

| Type | Tool | Scope | Status |
|------|------|-------|--------|
| Server unit tests | Jest | A `*.spec.ts` file beside its source file | 2006 tests pass |
| Server E2E tests | Jest | A separate configuration in `test/` | 350 tests. The database settings and the mail settings come from the environment first, and from `.env` for the rest. Thus a local `npm run test:e2e` reports 349 passed and 1 skipped. The mail suite is the skipped one, until `SMTP_HOST` points at a sink. CI runs with no Redis and skips 7 |
| Client unit tests | Vitest | A `*.spec.ts` file beside its source file. The runner options are in `client/vitest-base.config.mjs` | 1186 tests pass |
| Client E2E tests | Playwright | The `e2e/` directory. It uses the mock-server with 4 parallel workers | 223 tests pass |
| Mock server | Express | The `mock-server/` directory. It gives a full API simulation with RBAC support. The parity specs in `src/__tests__/` assert that its answers agree with the server | 489 tests pass |

## CI/CD

GitHub Actions runs on each push to `master` and on each pull request into `master`. It has 5 jobs:

| Job | Depends on | Steps | Artifacts |
|-----|-----------|-------|-----------|
| **Server - Checks** | - | audit (high), lint, format:check, typecheck, check:routes, check:enums, check:permissions, check:i18n, check:imports | - |
| **Server - Tests & Build** | server-checks | test:cov, build, migrations:run, E2E | Coverage report |
| **Mock Server** | - | audit (high), lint, format:check, typecheck, test | - |
| **Client** | - | audit (high), lint, format:check, typecheck, test:cov, build | Coverage report |
| **Client E2E** | mock-server | typecheck:e2e (after the mock-server install), ng build, then serve the static output, then Playwright Chromium | HTML report, test results |

In the `Server - Checks` job, `check:i18n` validates that each `ErrorKeys` value exists in each client
i18n JSON file. `check:imports` runs repo-wide, after its own `--self-test`.

Concurrency groups cancel a stale run when the pushes are rapid. The tests need no database and no
`.env` file, because each test runs against a mock.

Each job sets an explicit `timeout-minutes` value. The two check jobs use 10. `Client` uses 15.
`Server - Tests & Build` and `Client E2E` use 20.

Without such a value a job takes the default of six hours. A hung step then uses six hours of runner
time before it fails. Each bound is several times the normal duration of its job, thus only a hang
reaches it.

Two steps in `Client E2E` carry their own smaller bounds. A job-level bound turns a stalled step into
a red check after 20 minutes with no test signal. The two steps are the Playwright browser install (5
minutes) and `playwright install-deps` (4 minutes). The second step also uses `continue-on-error`. It
adds font packages only, and their absence changes no assertion. Its duration depends on the Ubuntu
mirror and not on this repository.

The `audit (high)` step in the three jobs runs `npm run audit:ci`. That script wraps
`npm audit --audit-level=high --omit=dev` in `scripts/audit-ci.mjs`.

The wrapper exists because `npm audit` sends a POST to the advisory endpoint of the registry, and the
fetch layer below it never retries a POST. Thus one 5xx answer from the registry makes the job red
with no source change.

The wrapper retries a maximum of 3 times, 15 s apart. It retries **only** when the output holds
`audit endpoint returned an error`. A true high-severity finding still fails on the first attempt.

## Security

- bcrypt hashes each password, with a cost factor of 12.
- **Account lockout** starts after 5 failed logins. The cooldown is 15 minutes. A password reset
  clears it, and the end of the window also clears it.
- **Email verification** is necessary before the first login.
- A **password reset token** is single-use and expires in 30 minutes. The reset revokes each session.
- An **administrator password change** immediately revokes each session of the target user.
- An **administrator email change** does the same. The endpoint exists to recover an account whose
  address an attacker controls. Thus the previous holder must not continue to authenticate with the
  tokens from before the change. A resubmitted address that does not change revokes nothing.
- A **self-service password change** (`PATCH /auth/profile`) requires `currentPassword`. Thus a stolen
  token cannot become a permanent account takeover. An account with OAuth only has no password, and
  it can omit the field when it sets its first password.
- The **refresh token cookie is HttpOnly**, with `SameSite=Strict`, the path `/api/v1/auth` and an
  expiry of 7 days. JavaScript can neither read nor steal the token, thus XSS cannot take it.

  The server rotates the token at each use. The rotation revokes the presented row conditionally.
  Thus two requests that race with the same token make exactly one live successor. The loser gets a
  plain 401 and not a session purge, because a benign double refresh from two tabs must not log the
  user out everywhere.

  **Reuse detection** follows the OAuth 2.0 BCP and RFC 6819. If a person presents a revoked refresh
  token before its natural expiry, the server purges the full session of the user. It writes a
  `TOKEN_REUSE_DETECTED` audit row and increases the
  `auth_events_total{event="token_reuse_detected"}` metric.
- A JWT access token lives 1 h and stays in an Angular signal. The app never writes it to
  `localStorage`.

  The app keeps the user data in `localStorage` under the `auth_user` key, and only to detect a
  previous session after a page reload. A type guard validates the value on a read. Web Storage is
  writable by the user and survives a deploy, thus the app discards a value with an incorrect shape
  instead of trusting it.

  The removal of that key is also the cross-tab logout signal. The other tabs of the session tear down
  on the `storage` event. Without it they stay usable until their in-memory access token expires.
- The `@Exclude()` decorator hides the password in an API response.
- **RBAC.** The resources and the actions are dynamic, and `@RegisterResource` discovers them
  automatically. `PermissionsGuard` and `@Authorize(['action', 'Subject'])` do the typed CASL
  permission checks.

  The server enforces instance-level ownership on a user mutation (`update`, `delete` and `restore`),
  on a role assignment (which prevents an escalation to a super role), and on a mutation of the
  permission set of a role.

  The app hydrates the CASL ability at bootstrap, before the route activation. It caches the
  permissions for each user for 5 minutes. The `isSuper` flag on a role bypasses each check. The
  `*appRequirePermissions="{ action, subject }"` directive controls the visibility in a template.
- **Audit logging** records 41 security-sensitive actions in the `audit_logs` table. Each row holds
  the actor, the target, the IP address and the request id. The actions include a login, a
  registration, a password change, a password reset, the CRUD of a user, a role and a permission, an
  OAuth link and unlink, a logout, a failed token refresh, a feature-flag change, and each
  administrator billing mutation. The billing mutations are a subscription cancel, an invoice refund,
  a webhook-event replay and a usage ingest.
- **`X-Request-Id` shape validation.** An incoming `x-request-id` header must match
  `^[A-Za-z0-9_-]{1,64}$`. The server replaces a value that does not match with a new UUID before the
  value reaches an audit row, a log line or a Prometheus label. Thus a person cannot inject data into
  a log or make a label with high cardinality.
- `class-validator` runs on the server DTOs with `whitelist: true` and `forbidNonWhitelisted: true`.
  The pipe removes an unknown property and rejects a request with an undeclared field. Thus a
  mass-assignment attack fails. On the client, the Angular `Validators` do the same work.
- **An explicit `null` is not "absent".** `@IsOptional()` skips each other validator for `null` and
  for `undefined`. Thus an optional field accepts `null` and passes it on with no validation.

  For that reason an optional field keeps `@IsOptional()` only when its consumer treats a `null`
  exactly as an omitted property. Three examples are a `value ?? fallback` expression, a truthiness
  check, and a column that is truly nullable.

  Each other optional field uses `@ValidateIf(propertyIsDefined)`
  (`server/src/common/validators/property-is-defined.ts`). A DTO that `PartialType` builds passes the
  equivalent option `{ skipNullProperties: false }`.

  A person observed two failure shapes. First, `PATCH /auth/profile` with `{"password": null}` set the
  column to NULL and answered 200. The account could then not log in. The other identity fields
  changed a 400 into a NOT NULL violation, which the server reported as a 500.

  Second, on the money path, `POST /billing/purchase` with `{"amountMinor": null}` got past the guard
  for an omitted amount, which compared with `=== undefined`. The value then compared as `0` against
  the product bounds. Thus a custom-amount product with a lower bound of zero sent `null` to the
  payment provider as the charge and as the receipt line.

  `POST /billing/subscription/cancel` had the same shape one layer lower. A `null` `mode` passed
  through the default parameter of the handler, which fills in only for an omitted property.

  The option of `PartialType` does not cover a property that the parent class already marks with
  `@IsOptional()`. Convert such a property in the parent class.
- The server escapes the pattern of a LIKE query. Thus a wildcard cannot do an SQL injection.
- File upload security: the route needs authentication. The limit is 5 MB. The server uses a type
  allowlist and sanitizes the file name.
- CORS is configurable, and it is permissive only in the `local` environment.
- Angular escapes a template value. Thus XSS fails.
