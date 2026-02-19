import { Router } from 'express';
import {
  addOAuthAccounts,
  getState,
  resetState,
  toUserResponse
} from './state';
import type { MockUser, OAuthAccount } from './types';

const router = Router();

// POST /__control/reset
router.post('/reset', (_req, res) => {
  resetState();
  res.json({ message: 'State reset to seed data' });
});

// GET /__control/state
router.get('/state', (_req, res) => {
  const state = getState();
  res.json({
    users: Array.from(state.users.values()).map(toUserResponse),
    oauthAccounts: Object.fromEntries(state.oauthAccounts),
    refreshTokens: state.refreshTokens.size
  });
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
    passwordResetTokens: Object.fromEntries(state.passwordResetTokens)
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

export default router;
