import { Router } from 'express';
import { randomUUID } from 'crypto';
import type {
  NotificationEvent,
  UserNotificationUnreadCountResponse
} from '@app/shared/types';
import {
  ErrorKeys,
  MAX_SSE_STREAMS_PER_USER,
  USER_NOTIFICATION_LIST_QUERY
} from '@app/shared/constants';
import { authGuard } from '../helpers/auth.helpers';
import { toUserNotificationResponse } from '../helpers/billing-notices.helpers';
import { sendError } from '../helpers/error-envelope.helpers';
import {
  listPage,
  listQueryErrors,
  rejectInvalidCursor
} from '../helpers/list-query.helpers';
import {
  requireUuid,
  sendValidationError
} from '../helpers/validation-error.helpers';
import { getState, isSessionLive } from '../state';
import {
  countSseConnections,
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

// GET /api/v1/notifications - mirrors UserNotificationsService.list.
router.get('/', authGuard, (req, res) => {
  const query = req.query as Record<string, unknown>;
  const errors = listQueryErrors(query, USER_NOTIFICATION_LIST_QUERY);

  if (errors.length > 0) {
    sendValidationError(res, 'query', errors);

    return;
  }

  if (rejectInvalidCursor(res, query)) return;

  const { user } = req as AuthenticatedRequest;
  const notices = getState()
    .userNotifications.values()
    .filter((notice) => notice.userId === user.id)
    .toArray();
  const page = listPage(notices, USER_NOTIFICATION_LIST_QUERY, query);

  res.json({
    data: page.data.map(toUserNotificationResponse),
    meta: page.meta
  });
});

// GET /api/v1/notifications/unread-count
router.get('/unread-count', authGuard, (req, res) => {
  const { user } = req as AuthenticatedRequest;
  const unread = getState()
    .userNotifications.values()
    .filter((notice) => notice.userId === user.id && notice.readAt === null)
    .toArray().length;

  res.json({ unread } satisfies UserNotificationUnreadCountResponse);
});

// POST /api/v1/notifications/:id/read - a notice of another user answers as
// a missing one, as the server does.
router.post('/:id/read', authGuard, requireUuid('id'), (req, res) => {
  const { user } = req as AuthenticatedRequest;
  const notice = getState().userNotifications.get(String(req.params['id']));

  if (notice?.userId !== user.id) {
    sendError(res, ErrorKeys.NOTIFICATIONS.NOT_FOUND, 'Notification not found');

    return;
  }

  notice.readAt ??= new Date().toISOString();
  res.status(204).end();
});

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
  // The value that Nest writes for an SSE stream.
  res.setHeader(
    'Cache-Control',
    'private, no-cache, no-store, must-revalidate, max-age=0, no-transform'
  );
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

export default router;
