import type { Request, Response } from 'express';
import { MAX_CONCURRENT_SESSIONS } from '@app/shared/constants';
import { pruneOldestUserTokens } from './auth.helpers';
import {
  endPresentedSession,
  setRefreshTokenCookie
} from './refresh-cookie.helpers';
import { generateSessionId, generateTokens } from '../jwt.utils';
import { getState, logAudit, registerSession, toUserResponse } from '../state';
import { normalizeUserAgent } from '../utils/user-agent';
import { resolveEntitlementLimit } from '../middleware/billing.middleware';
import type { MockUser } from '../types';

/**
 * The last step of every sign-in (password, second factor and the OAuth
 * exchange), as the server's SignInCompletionService is.
 */
export function completeSignIn(
  req: Request,
  res: Response,
  user: MockUser,
  details?: Record<string, unknown>
): void {
  const state = getState();
  // Before the new session exists, so the session limit prunes against a
  // count that no longer holds the session this browser is replacing.
  endPresentedSession(req);
  const sessionId = generateSessionId();
  const tokens = generateTokens(user, sessionId);
  state.refreshTokens.set(tokens.refresh_token, user.id);
  registerSession(
    tokens.refresh_token,
    sessionId,
    normalizeUserAgent(req.headers['user-agent'])
  );
  // Concurrent-session allowance is plan-driven; a plan carrying no `sessions`
  // limit (Free, usage) keeps the constant, exactly as the server resolves it.
  pruneOldestUserTokens(
    state.refreshTokens,
    user.id,
    resolveEntitlementLimit(user.id, 'sessions') ?? MAX_CONCURRENT_SESSIONS
  );

  logAudit('USER_LOGIN_SUCCESS', {
    actorId: user.id,
    actorEmail: user.email,
    targetId: user.id,
    targetType: 'User',
    ...(details && { details }),
    ip: req.ip
  });

  const { refresh_token, ...publicTokens } = tokens;
  setRefreshTokenCookie(res, refresh_token);
  res.json({ tokens: publicTokens, user: toUserResponse(user) });
}
