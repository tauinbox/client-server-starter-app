import { Router } from 'express';
import {
  addOAuthAccounts,
  getState,
  resetState,
  toUserResponse
} from './state';
import type { StateSnapshot } from './control.types';
import type {
  MockPermission,
  MockRole,
  MockRolePermission,
  MockUser,
  OAuthAccount,
  State
} from './types';
import type { NotificationEvent } from '@app/shared/types';
import { pushToAll, pushToUser } from './sse-hub';

const router = Router();

// StateSnapshot is a mapped type { [K in keyof State]: unknown }, so
// TypeScript will error here whenever State gains a new field that is not
// yet returned by this function.
function buildStateSnapshot(state: State): StateSnapshot {
  return {
    users: Array.from(state.users.values()).map(toUserResponse),
    oauthAccounts: Object.fromEntries(state.oauthAccounts),
    refreshTokens: state.refreshTokens.size,
    revokedRefreshTokens: state.revokedRefreshTokens.size,
    emailVerificationTokens: state.emailVerificationTokens.size,
    passwordResetTokens: state.passwordResetTokens.size,
    pendingEmailTokens: state.pendingEmailTokens.size,
    resources: Array.from(state.resources.values()),
    actions: Array.from(state.actions.values()),
    roles: Array.from(state.roles.values()),
    permissions: Array.from(state.permissions.values()),
    rolePermissions: state.rolePermissions,
    auditLogs: state.auditLogs,
    captchaConfig: state.captchaConfig,
    captchaAttempts: state.captchaAttempts.size
  };
}

// POST /__control/reset
router.post('/reset', (_req, res) => {
  resetState();
  res.json({ message: 'State reset to seed data' });
});

// GET /__control/state
router.get('/state', (_req, res) => {
  res.json(buildStateSnapshot(getState()));
});

// POST /__control/users — add or override users
router.post('/users', (req, res) => {
  const users: MockUser[] = req.body;
  if (!Array.isArray(users)) {
    res.status(400).json({ message: 'Body must be an array of users' });
    return;
  }

  const state = getState();
  for (const user of users) {
    state.users.set(user.id, user);
  }

  res.json({ message: `Added/updated ${users.length} user(s)` });
});

// GET /__control/tokens — get all verification and reset tokens (for E2E)
router.get('/tokens', (_req, res) => {
  const state = getState();
  res.json({
    emailVerificationTokens: Object.fromEntries(state.emailVerificationTokens),
    passwordResetTokens: Object.fromEntries(state.passwordResetTokens),
    pendingEmailTokens: Object.fromEntries(state.pendingEmailTokens)
  });
});

// POST /__control/oauth-accounts — add OAuth accounts for a user
router.post('/oauth-accounts', (req, res) => {
  const { userId, accounts }: { userId: string; accounts: OAuthAccount[] } =
    req.body;

  if (!userId || !Array.isArray(accounts)) {
    res
      .status(400)
      .json({ message: 'Body must have userId and accounts array' });
    return;
  }

  addOAuthAccounts(userId, accounts);
  res.json({
    message: `Added ${accounts.length} OAuth account(s) for user ${userId}`
  });
});

// POST /__control/roles — add or override roles
router.post('/roles', (req, res) => {
  const roles: MockRole[] = req.body;
  if (!Array.isArray(roles)) {
    res.status(400).json({ message: 'Body must be an array of roles' });
    return;
  }

  const state = getState();
  for (const role of roles) {
    state.roles.set(role.id, role);
  }

  res.json({ message: `Added/updated ${roles.length} role(s)` });
});

// POST /__control/permissions — add or override permissions
router.post('/permissions', (req, res) => {
  const permissions: MockPermission[] = req.body;
  if (!Array.isArray(permissions)) {
    res.status(400).json({ message: 'Body must be an array of permissions' });
    return;
  }

  const state = getState();
  for (const permission of permissions) {
    state.permissions.set(permission.id, permission);
  }

  res.json({ message: `Added/updated ${permissions.length} permission(s)` });
});

// POST /__control/role-permissions — replace all role-permission assignments
router.post('/role-permissions', (req, res) => {
  const rolePermissions: MockRolePermission[] = req.body;
  if (!Array.isArray(rolePermissions)) {
    res
      .status(400)
      .json({ message: 'Body must be an array of role-permissions' });
    return;
  }

  const state = getState();
  state.rolePermissions = rolePermissions;

  res.json({ message: `Set ${rolePermissions.length} role-permission(s)` });
});

// POST /__control/invalidate-access-tokens — set tokenRevokedAt for a user.
// Existing access tokens issued before this call become invalid (the auth
// helper compares decoded.iat to user.tokenRevokedAt). Refresh tokens are
// LEFT INTACT so the client's 401 interceptor can refresh-and-retry.
router.post('/invalidate-access-tokens', (req, res) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) {
    res.status(400).json({ message: 'userId is required' });
    return;
  }
  const state = getState();
  const user = state.users.get(userId);
  if (!user) {
    res.status(404).json({ message: 'user not found' });
    return;
  }
  user.tokenRevokedAt = new Date().toISOString();
  res.json({ message: `tokens invalidated for user ${userId}` });
});

// POST /__control/change-user-roles — mutate user.roles and push SSE without
// revoking tokens. Lets tests verify live RBAC reactivity on the client (the
// next /auth/permissions fetch reflects the new roles, but the existing
// session keeps working — no forced logout).
router.post('/change-user-roles', (req, res) => {
  const { userId, newRoles } = req.body as {
    userId?: string;
    newRoles?: string[];
  };
  if (!userId || !Array.isArray(newRoles)) {
    res.status(400).json({ message: 'userId and newRoles[] required' });
    return;
  }
  const state = getState();
  const user = state.users.get(userId);
  if (!user) {
    res.status(404).json({ message: 'user not found' });
    return;
  }
  user.roles = newRoles;
  pushToUser(userId, { type: 'permissions_updated', userId });
  res.json({ message: `roles updated for user ${userId}` });
});

// POST /__control/revoke-user-sessions — full simulation of the server's
// UserRoleChangedListener. Optionally swaps user.roles, deletes ALL refresh
// tokens for the user, sets tokenRevokedAt, and pushes a `permissions_updated`
// SSE event. Use to verify forced-logout semantics on role revocation.
router.post('/revoke-user-sessions', (req, res) => {
  const { userId, newRoles } = req.body as {
    userId?: string;
    newRoles?: string[];
  };
  if (!userId) {
    res.status(400).json({ message: 'userId is required' });
    return;
  }
  const state = getState();
  const user = state.users.get(userId);
  if (!user) {
    res.status(404).json({ message: 'user not found' });
    return;
  }
  if (Array.isArray(newRoles)) {
    user.roles = newRoles;
  }
  for (const [token, uid] of state.refreshTokens.entries()) {
    if (uid === userId) state.refreshTokens.delete(token);
  }
  for (const [token, uid] of state.revokedRefreshTokens.entries()) {
    if (uid === userId) state.revokedRefreshTokens.delete(token);
  }
  user.tokenRevokedAt = new Date().toISOString();
  pushToUser(userId, { type: 'permissions_updated', userId });
  res.json({ message: `sessions revoked for user ${userId}` });
});

// POST /__control/captcha — toggle captcha enablement and reset attempts.
// Used by E2E to drive the soft-trigger flow without depending on real
// Turnstile. When enabled, the client resolves the advertised site key from
// /api/v1/auth/captcha-config; mock-server accepts any non-empty token.
router.post('/captcha', (req, res) => {
  const { enabled, siteKey } = req.body as {
    enabled?: boolean;
    siteKey?: string | null;
  };
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ message: 'enabled (boolean) is required' });
    return;
  }
  const state = getState();
  state.captchaConfig = {
    enabled,
    // Default to the Turnstile public test sitekey that always passes.
    siteKey: siteKey ?? (enabled ? '1x00000000000000000000AA' : null)
  };
  state.captchaAttempts.clear();
  res.json({ message: `captcha ${enabled ? 'enabled' : 'disabled'}` });
});

// POST /__control/notify — push a test notification event (E2E helper)
router.post('/notify', (req, res) => {
  const event = req.body as NotificationEvent;
  if (!event || !event.type) {
    res.status(400).json({ message: 'Body must be a valid NotificationEvent' });
    return;
  }
  if (
    event.type === 'session_invalidated' ||
    event.type === 'permissions_updated'
  ) {
    pushToUser(event.userId, event);
  } else {
    pushToAll(event);
  }
  res.json({ ok: true });
});

export default router;
