import { Router } from 'express';
import { ErrorKeys } from '@app/shared/constants';
import { isStepUpOperation } from '@app/shared/utils/step-up-operation';
import { findUserById, getState, logAudit, toUserResponse } from '../state';
import { authGuard } from '../helpers/auth.helpers';
import { validationError } from '../helpers/validation-error.helpers';
import {
  OAUTH_DATA_COOKIE,
  OAUTH_DATA_COOKIE_PATH,
  OAUTH_PROVIDERS,
  REFRESH_COOKIE_OPTIONS,
  REFRESH_TOKEN_COOKIE
} from '../constants';
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
  if (!OAUTH_PROVIDERS.includes(provider)) {
    res.status(400).json({
      message: `Invalid OAuth provider: ${provider}`,
      statusCode: 400,
      errorKey: ErrorKeys.AUTH.INVALID_OAUTH_PROVIDER
    });
    return;
  }

  const state = getState();
  const accounts = state.oauthAccounts.get(user.id) || [];

  if (!accounts.some((a) => a.provider === provider)) {
    res.status(404).json({
      message: `No linked ${provider} account found`,
      statusCode: 404,
      errorKey: ErrorKeys.AUTH.OAUTH_PROVIDER_NOT_LINKED
    });
    return;
  }

  const otherOAuth = accounts.filter((a) => a.provider !== provider).length;

  if (!user.password && otherOAuth === 0) {
    res.status(400).json({
      message:
        'This is the only way you can sign in. Link another provider first, or set a password through the forgot-password link.',
      statusCode: 400,
      errorKey: ErrorKeys.AUTH.UNLINK_LAST_PROVIDER
    });
    return;
  }

  state.oauthAccounts.set(
    user.id,
    accounts.filter((a) => a.provider !== provider)
  );

  logAudit('OAUTH_UNLINK', {
    actorId: user.id,
    actorEmail: user.email,
    targetId: user.id,
    targetType: 'User',
    details: { provider },
    ip: req.ip
  });

  console.log(
    `[PROVIDER UNLINKED] To: ${user.email}\n  Provider: ${provider} | IP: ${req.ip}`
  );

  res.json({ message: `${provider} account unlinked successfully` });
});

// The provider round trip needs a real identity provider, so both halves stay
// stubs. What the round trip *produces* - the `oauth_data` cookie - is minted
// by POST /__control/oauth-data instead, which is how E2E drives the exchange.
for (const provider of OAUTH_PROVIDERS) {
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

// POST /api/v1/auth/oauth/exchange
router.post('/exchange', (req, res) => {
  const cookie = (req.cookies as Record<string, string> | undefined)?.[
    OAUTH_DATA_COOKIE
  ];

  res.clearCookie(OAUTH_DATA_COOKIE, { path: OAUTH_DATA_COOKIE_PATH });

  if (!cookie) {
    res.status(400).json({
      message: 'Missing OAuth data',
      statusCode: 400,
      errorKey: ErrorKeys.AUTH.MISSING_OAUTH_DATA
    });
    return;
  }

  const state = getState();
  const pending = state.oauthDataTokens.get(cookie);
  // One-shot, like the cookie the real server clears on exchange.
  state.oauthDataTokens.delete(cookie);
  const user = pending ? findUserById(pending.userId) : undefined;

  if (!pending || pending.expiresAt < Date.now() || !user) {
    res.status(400).json({
      message: 'Invalid or expired OAuth data',
      statusCode: 400,
      errorKey: ErrorKeys.AUTH.INVALID_OAUTH_DATA
    });
    return;
  }

  const { refresh_token, ...publicTokens } = pending.tokens;
  res.cookie(REFRESH_TOKEN_COOKIE, refresh_token, REFRESH_COOKIE_OPTIONS);
  res.json({ tokens: publicTokens, user: toUserResponse(user) });
});

// POST /api/v1/auth/oauth/link-init (stub)
router.post('/link-init', authGuard, (_req, res) => {
  res.json({ message: 'Link initiated' });
});

// POST /api/v1/auth/oauth/reauth-init (stub)
// The real server sets an intent cookie that its provider callback consumes.
// Both provider halves are 501 here, so the proof the callback would mint is
// seeded by POST /__control/reauth-proof instead. The body is still validated,
// because the operation it declares is what binds the proof.
router.post('/reauth-init', authGuard, (req, res) => {
  const { operation } = req.body as { operation?: unknown };

  if (!isStepUpOperation(operation)) {
    res
      .status(400)
      .json(validationError('operation must be a known step-up operation'));
    return;
  }

  res.json({ message: 'Re-authentication initiated' });
});

export default router;
