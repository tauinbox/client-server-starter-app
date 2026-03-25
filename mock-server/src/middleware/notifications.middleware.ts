import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authGuard } from '../helpers/auth.helpers';
import {
  pushToAll,
  pushToUser,
  registerSseConnection,
  removeSseConnection
} from '../sse-hub';
import type { AuthenticatedRequest } from '../types';

const KEEPALIVE_INTERVAL_MS = 30_000;

const router = Router();

// GET /api/v1/notifications/stream
router.get('/stream', authGuard, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const userId = (req as AuthenticatedRequest).user.id;
  const connectionId = uuidv4();
  registerSseConnection(userId, connectionId, res);

  // Keep-alive comment to prevent proxy timeouts
  const keepalive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(keepalive);
    }
  }, KEEPALIVE_INTERVAL_MS);

  req.on('close', () => {
    clearInterval(keepalive);
    removeSseConnection(userId, connectionId);
  });
});

export { pushToAll, pushToUser };
export default router;
