import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  ErrorKeys,
  STEP_UP_OPERATION,
  TOTP_DIGITS
} from '@app/shared/constants';
import type { ActiveSessionResponse } from '@app/shared/types';
import { authGuard } from '../helpers/auth.helpers';
import {
  clearReauthProofCookie,
  isValidCodeShape,
  isValidPasswordShape,
  sendWithRetryAfter,
  stepUpError
} from '../helpers/reauth.helpers';
import {
  requireUuid,
  validationError
} from '../helpers/validation-error.helpers';
import {
  endOtherUserSessions,
  endUserSession,
  getState,
  liveSessionIdsOf,
  logAudit
} from '../state';
import type { AuthenticatedRequest } from '../types';

// Mirrors SessionsController.
const router = Router();

/**
 * Mirrors the ValidationPipe on `MfaStepUpDto`, then `assertStepUp`. Answers
 * and returns false when the caller did not prove itself.
 */
function passesStepUp(req: Request, res: Response): boolean {
  const { user } = req as AuthenticatedRequest;
  const { currentPassword, code } = (req.body ?? {}) as Record<string, unknown>;

  if (currentPassword !== undefined && !isValidPasswordShape(currentPassword)) {
    res.status(400).json(validationError('currentPassword is required'));
    return false;
  }
  if (code !== undefined && !isValidCodeShape(code)) {
    res
      .status(400)
      .json(
        validationError(
          `code must be longer than or equal to ${TOTP_DIGITS} characters`
        )
      );
    return false;
  }

  const refusal = stepUpError(
    req,
    user,
    currentPassword,
    code,
    STEP_UP_OPERATION.SESSION_REVOKE
  );
  if (refusal) {
    sendWithRetryAfter(res, refusal);
    return false;
  }
  return true;
}

function logRevoke(req: Request, scope: 'one' | 'others', count: number) {
  const { user } = req as AuthenticatedRequest;
  logAudit('SESSION_REVOKE', {
    actorId: user.id,
    actorEmail: user.email,
    targetId: user.id,
    targetType: 'User',
    details: { scope, count },
    ip: req.ip
  });
}

// GET /api/v1/auth/sessions
router.get('/', authGuard, (req, res) => {
  const { user, sessionId } = req as AuthenticatedRequest;
  const state = getState();

  const sessions: ActiveSessionResponse[] = liveSessionIdsOf(user.id).map(
    (id) => ({
      id,
      current: id === sessionId,
      userAgent: state.sessionUserAgents.get(id) ?? null,
      startedAt: new Date(state.sessionStarts.get(id) ?? 0).toISOString(),
      lastActiveAt: new Date(state.sessionLastActive.get(id) ?? 0).toISOString()
    })
  );
  res.json(sessions);
});

// DELETE /api/v1/auth/sessions/:sessionId
router.delete(
  '/:sessionId',
  authGuard,
  requireUuid('sessionId'),
  (req, res) => {
    const { user, sessionId: current } = req as AuthenticatedRequest;
    const target = String(req.params['sessionId']);

    if (target === current) {
      res.status(400).json({
        message: 'Use sign out to end the session of this device',
        statusCode: 400,
        errorKey: ErrorKeys.AUTH.SESSION_IS_CURRENT
      });
      return;
    }

    if (!passesStepUp(req, res)) return;

    if (!endUserSession(user.id, target)) {
      res.status(404).json({
        message: 'Session not found',
        statusCode: 404,
        errorKey: ErrorKeys.AUTH.SESSION_NOT_FOUND
      });
      return;
    }

    clearReauthProofCookie(res);
    logRevoke(req, 'one', 1);
    res.json({ message: 'Session has ended' });
  }
);

// DELETE /api/v1/auth/sessions
router.delete('/', authGuard, (req, res) => {
  const { user, sessionId } = req as AuthenticatedRequest;

  if (!passesStepUp(req, res)) return;

  const count = endOtherUserSessions(user.id, sessionId);
  clearReauthProofCookie(res);
  logRevoke(req, 'others', count);
  res.json({ message: 'Other sessions have ended', count });
});

export default router;
