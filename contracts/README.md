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

When adding or removing a server endpoint, update the matching `routes/<feature>.json`
with `expectedStatus: 401` for an authenticated endpoint (see CLAUDE.md). The new route
must also exist in `mock-server/` and return its declared status in the same change.
