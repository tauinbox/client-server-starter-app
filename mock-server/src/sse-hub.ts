import type { Response } from 'express';
import type { NotificationEvent } from '@app/shared/types';

// Map<userId, Map<connectionId, Response>>
const connections = new Map<string, Map<string, Response>>();

export function registerSseConnection(
  userId: string,
  connectionId: string,
  res: Response
): void {
  if (!connections.has(userId)) {
    connections.set(userId, new Map());
  }
  connections.get(userId)!.set(connectionId, res);
}

export function removeSseConnection(
  userId: string,
  connectionId: string
): void {
  const userConns = connections.get(userId);
  if (!userConns) return;
  userConns.delete(connectionId);
  if (userConns.size === 0) {
    connections.delete(userId);
  }
}

function sendEvent(res: Response, event: NotificationEvent): void {
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    // Flush immediately so the client receives the event without buffering
    // compression middleware adds an optional flush() method to the response
    (res as Response & { flush?: () => void }).flush?.();
  } catch {
    // Connection already closed — ignore
  }
}

export function pushToUser(userId: string, event: NotificationEvent): void {
  const userConns = connections.get(userId);
  if (!userConns) return;
  for (const res of userConns.values()) {
    sendEvent(res, event);
  }
}

export function pushToAll(event: NotificationEvent): void {
  for (const userConns of connections.values()) {
    for (const res of userConns.values()) {
      sendEvent(res, event);
    }
  }
}
