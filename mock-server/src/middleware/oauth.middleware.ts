import { Router } from 'express';
import { getState } from '../state';
import { authGuard } from '../helpers/auth.helpers';
import type { AuthenticatedRequest } from '../types';

const router = Router();

// GET /api/v1/auth/oauth/accounts
router.get('/accounts', authGuard, (req, res) => {
  const { user } = req as AuthenticatedRequest;
  const accounts = getState().oauthAccounts.get(user.id) || [];
  res.json(
    accounts.map((a) => ({
      provider: a.provider,
      createdAt: a.createdAt
    }))
  );
});

// DELETE /api/v1/auth/oauth/accounts/:provider
router.delete('/accounts/:provider', authGuard, (req, res) => {
  const { user } = req as AuthenticatedRequest;
  const provider = req.params['provider'] as string;
  const validProviders = ['google', 'facebook', 'vk'];
  if (!validProviders.includes(provider)) {
    res.status(400).json({
      message: `Invalid OAuth provider: ${provider}`,
      statusCode: 400
    });
    return;
  }

  const state = getState();
  const accounts = state.oauthAccounts.get(user.id) || [];
  const otherOAuth = accounts.filter((a) => a.provider !== provider).length;

  if (!user.password && otherOAuth === 0) {
    res.status(400).json({
      message:
        'Cannot unlink the last OAuth provider without a password set. Please set a password first.',
      statusCode: 400
    });
    return;
  }

  state.oauthAccounts.set(
    user.id,
    accounts.filter((a) => a.provider !== provider)
  );

  res.json({ message: `${provider} account unlinked successfully` });
});

// Stub OAuth redirect endpoints
for (const provider of ['google', 'facebook', 'vk']) {
  router.get(`/${provider}`, (_req, res) => {
    res.status(501).json({
      message: `OAuth ${provider} redirect requires a real backend. Use the mock-server for API-level testing only.`,
      statusCode: 501
    });
  });

  router.get(`/${provider}/callback`, (_req, res) => {
    res.status(501).json({
      message: `OAuth ${provider} callback requires a real backend.`,
      statusCode: 501
    });
  });
}

// POST /api/v1/auth/oauth/link-init (stub)
router.post('/link-init', authGuard, (_req, res) => {
  res.json({ message: 'Link initiated' });
});

export default router;
