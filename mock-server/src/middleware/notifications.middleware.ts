import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { NotificationEvent } from '@app/shared/types';
import { MAX_SSE_STREAMS_PER_USER } from '@app/shared/constants';
import { authGuard } from '../helpers/auth.helpers';
import { isSessionLive } from '../state';
import {
  countSseConnections,
  pushToAll,
  pushToUser,
  registerSseConnection,
  removeSseConnection
} from '../sse-hub';
import type { AuthenticatedRequest } from '../types';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_FRAME = 'data: \n\n';

/** A test can shorten the heartbeat, which also checks the session. */
function heartbeatIntervalMs(): number {
  return (
    Number(process.env['MOCK_SSE_HEARTBEAT_MS']) ||
    DEFAULT_HEARTBEAT_INTERVAL_MS
  );
}

const router = Router();

// GET /api/v1/notifications/stream
router.get('/stream', authGuard, (req, res) => {
  const { user, sessionId } = req as AuthenticatedRequest;
  const userId = user.id;
  if (countSseConnections(userId) >= MAX_SSE_STREAMS_PER_USER) {
    // eslint-disable-next-line no-restricted-syntax -- the server sends this 429 with no key
    res.status(429).json({ message: 'Too many open notification streams' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(HEARTBEAT_FRAME);

  const connectionId = randomUUID();
  registerSseConnection(userId, connectionId, res);

  // The stream is authenticated only when it opens, so the keep-alive also
  // checks the session, as the server does: an ended session gets
  // `session_invalidated` as the last frame and the response ends.
  const keepalive = setInterval(() => {
    if (!isSessionLive(sessionId)) {
      clearInterval(keepalive);
      removeSseConnection(userId, connectionId);
      const event: NotificationEvent = { type: 'session_invalidated' };
      res.end(`data: ${JSON.stringify(event)}\n\n`);
      return;
    }
    try {
      res.write(HEARTBEAT_FRAME);
    } catch {
      clearInterval(keepalive);
    }
  }, heartbeatIntervalMs());

  req.on('close', () => {
    clearInterval(keepalive);
    removeSseConnection(userId, connectionId);
  });
});

export { pushToAll, pushToUser };
export default router;
