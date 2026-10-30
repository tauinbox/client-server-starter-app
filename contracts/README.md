# API route contracts

`routes.json` is a thin index holding the manifest `version` (kept in sync with
the server package version by the release process) and a description.

The actual route entries live in **per-feature files** under `routes/`, one file
per server module:

| File | Server module |
|------|---------------|
| `routes/health.json` | `core/health` |
| `routes/auth.json` | `auth` (auth controller + captcha) |
| `routes/oauth.json` | `auth` (oauth controller) |
| `routes/users.json` | `users` |
| `routes/roles.json` | `auth` (roles controller) |
| `routes/rbac.json` | `auth` (rbac controller) |
| `routes/notifications.json` | `notifications` |
| `routes/feature-flags.json` | `feature-flags` |
| `routes/billing.json` | `billing` (user + plans + webhooks) |
| `routes/billing-admin.json` | `billing` (admin controller) |

Each file is `{ "routes": [{ "method", "path", "expectedStatus", "policy" }, ...] }`.

## Access policy (`policy`)

Each route states its access policy. The decorators of the handler and of its
class must equal it, and so must the gate of the mock-server route.

```json
"policy": {
  "access": "update:Profile",
  "writes": "update:Profile",
  "stepUp": false,
  "countFailuresOnlyWhenBody": true,
  "skipMfaEnrolmentGate": true,
  "throttle": ["login-long-window"]
}
```

- `access`: `public` (`@Public`), `optional` (`@OptionalAuth`), `signed-in`
  (no decorator: the global JWT guard), or `<action>:<Subject>` (`@Authorize`).
  The mock route has no guard, `authGuard`, or
  `permissionGuard('<action>', '<Subject>')`.
- `writes`: the `<action>:<Subject>` of the records that the route changes.
  `Profile` is the own account of the caller. It is `null` for a read, and for
  a route that changes only sign-in, sign-out, token or own-billing state.
  Routes with the same `writes` must have the same `access`. A route that has a
  reason to differ carries `"accessExempt": "<reason>"`.
- `stepUp`: the handler has `@StepUpRoute`. A handler whose body is
  `StepUpFactorsDto` or `MfaSetupDto` must have it.
- `countFailuresOnlyWhenBody`: `@CountFailuresOnlyWhenBody` or `@StepUpRoute`.
- `skipMfaEnrolmentGate`: `@SkipMfaEnrolmentGate`. The mock passes
  `{ skipMfaEnrolmentGate: true }` to `permissionGuard`.
- `throttle`: the sorted throttler names that `@Throttle` or `@StepUpRoute`
  set, `"skip"` for `@SkipThrottle`, or `null`.

## How it's consumed

All consumers glob `routes/*.json` and flatten every `routes` array — there is no
list of modules to maintain. **Adding a feature = drop a new `routes/<feature>.json`.**

- `server/scripts/check-routes.ts` (`npm run check:routes`) — verifies the manifest
  matches the routes extracted from server controllers, and that `version` matches
  `server/package.json`.
- `server/scripts/check-route-policy.ts` (`npm run check:route-policy`) — verifies
  each `policy` against the decorators and the mock-server gate, as described
  above. `--self-test` runs the four rules against planted fixtures.
- `server/test/check-auth-coverage.e2e-spec.ts` — asserts every `expectedStatus: 401`
  route actually returns 401 unauthenticated.
- `mock-server/src/__tests__/contract.spec.ts` — asserts the mock server returns each
  declared `expectedStatus`.

## Request scenarios (`scenarios/`)

`scenarios/<feature>.json` holds request scenarios for the routes of
`routes/<feature>.json`. A scenario is one request (or the same request sent
`repeat` times), the account that sends it and the state before it, and the
expected status, `errorKey` and audit actions:

```json
{ "scenarios": [{
  "name": "the current password ends the other sessions",
  "route": "DELETE /api/v1/auth/sessions",
  "actor": "user", "auth": "bearer", "state": ["second-session"],
  "body": { "currentPassword": "$password" },
  "expect": { "status": 200, "errorKey": null, "audit": ["SESSION_REVOKE"] }
}] }
```

- `route` is one entry of `routes/<feature>.json`. `path` replaces its path
  when the entry holds a sample id (`/api/v1/auth/sessions/$otherSessionId`).
- `actor`, `target` and `state` name fixtures from closed lists, and a string
  that is exactly a placeholder (`$email`, `$password`, `$code` ...) gets its
  value at run time. The lists, their meaning and the loader are in
  `shared/src/utils/request-scenarios.ts`.
- `headers` holds request headers, for example `{ "If-Match": "\"1\"" }`. A
  header value that is exactly a placeholder gets its value too.
- `audit` is the full list of actions of the rows that the requests write and
  that name an account of the scenario. An empty list is a statement: no row.
  The runners compare the list in any order.
- `expect.earlier` is the answer of each request before the last, when it is
  not the same as the last one.

Consumers:

- `server/test/scenarios.e2e-spec.ts` runs every scenario against the real
  server and the real database.
- `mock-server/src/__tests__/scenarios.spec.ts` runs the same files against the
  mock server. A difference between the two servers fails one of the two runs.
- `server/scripts/check-scenarios.ts` (`npm run check:scenarios`) fails when a
  POST, PUT, PATCH or DELETE route of a route file has no scenario with a status
  below 400, unless the route entry carries `"noSuccessScenario": "<reason>"`,
  and when a scenario names a route that its route file does not hold. The
  routes in its `PENDING_ROUTES` list have no scenario yet. A listed route that
  has a scenario or that no route file holds fails the check, and so does a new
  route that is not listed. CI runs the check as
  `npm run check:scenarios -- --base origin/master`: a listed route also fails
  when it is not a route with no success scenario on `master`, so a change
  cannot add a route to the list and the list can only get shorter. CI runs
  `npm run check:scenarios -- --self-test` before the check.

Rate limiting is an allowed difference between the server and the mock, so a
scenario does not depend on a 429. Each server scenario starts with a full rate
limit budget.

When adding or removing a server endpoint, update the matching `routes/<feature>.json`
with `expectedStatus: 401` for an authenticated endpoint (`npm run check:routes` checks it). The new route
must also exist in `mock-server/` and return its declared status in the same change.
