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

export function countSseConnections(userId: string): number {
  return connections.get(userId)?.size ?? 0;
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
  } catch {
    // Connection already closed - ignore
  }
}

export function pushToUser(userId: string, event: NotificationEvent): void {
  const userConns = connections.get(userId);
  if (!userConns) return;
  for (const res of userConns.values()) {
    sendEvent(res, event);
  }
}

/** Deliver only to connected users the predicate accepts. */
export function pushToUsersMatching(
  predicate: (userId: string) => boolean,
  event: NotificationEvent
): void {
  for (const [userId, userConns] of connections) {
    if (!predicate(userId)) continue;
    for (const res of userConns.values()) {
      sendEvent(res, event);
    }
  }
}

export function pushToAll(event: NotificationEvent): void {
  pushToUsersMatching(() => true, event);
}
