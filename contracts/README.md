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

Each file is `{ "routes": [{ "method", "path", "expectedStatus" }, ...] }`.

## How it's consumed

All consumers glob `routes/*.json` and flatten every `routes` array — there is no
list of modules to maintain. **Adding a feature = drop a new `routes/<feature>.json`.**

- `server/scripts/check-routes.ts` (`npm run check:routes`) — verifies the manifest
  matches the routes extracted from server controllers, and that `version` matches
  `server/package.json`.
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
  files in its `PENDING` list are not checked yet. A `PENDING` file that is
  complete fails the check, so the list can only get shorter.

Rate limiting is an allowed difference between the server and the mock, so a
scenario does not depend on a 429. Each server scenario starts with a full rate
limit budget.

When adding or removing a server endpoint, update the matching `routes/<feature>.json`
with `expectedStatus: 401` for an authenticated endpoint (see CLAUDE.md). The new route
must also exist in `mock-server/` and return its declared status in the same change.
