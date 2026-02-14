import { Router } from 'express';
import { getState } from '../state';
import { requireAuth } from '../helpers/auth.helpers';

const router = Router();

// GET /api/v1/auth/oauth/accounts
router.get('/accounts', (req, res) => {
  const auth = requireAuth(req);
  if ('error' in auth) {
    res
      .status(auth.error)
      .json({ message: 'Unauthorized', statusCode: auth.error });
    return;
  }

  const accounts = getState().oauthAccounts.get(auth.user.id) || [];
  res.json(
    accounts.map((a) => ({
      provider: a.provider,
      createdAt: a.createdAt
    }))
  );
});

// DELETE /api/v1/auth/oauth/accounts/:provider
router.delete('/accounts/:provider', (req, res) => {
  const auth = requireAuth(req);
  if ('error' in auth) {
    res
      .status(auth.error)
      .json({ message: 'Unauthorized', statusCode: auth.error });
    return;
  }

  const provider = req.params.provider;
  const validProviders = ['google', 'facebook', 'vk'];
  if (!validProviders.includes(provider)) {
    res.status(400).json({
      message: `Invalid OAuth provider: ${provider}`,
      statusCode: 400
    });
    return;
  }

  const state = getState();
  const accounts = state.oauthAccounts.get(auth.user.id) || [];
  const otherOAuth = accounts.filter((a) => a.provider !== provider).length;

  if (!auth.user.password && otherOAuth === 0) {
    res.status(400).json({
      message:
        'Cannot unlink the last OAuth provider without a password set. Please set a password first.',
      statusCode: 400
    });
    return;
  }

  state.oauthAccounts.set(
    auth.user.id,
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
router.post('/link-init', (req, res) => {
  const auth = requireAuth(req);
  if ('error' in auth) {
    res
      .status(auth.error)
      .json({ message: 'Unauthorized', statusCode: auth.error });
    return;
  }

  res.json({ message: 'Link initiated' });
});

export default router;
