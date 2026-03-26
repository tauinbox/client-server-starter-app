import { Inject, Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
import type { NotificationEvent } from '@app/shared/types';
import {
  SSE_CONNECTIONS_REF,
  type SseConnectionsRef
} from '../core/metrics/metrics.module';

@Injectable()
export class NotificationsService {
  readonly #connections = new Map<string, Map<string, Subject<MessageEvent>>>();

  constructor(
    @Inject(SSE_CONNECTIONS_REF) private readonly sseRef: SseConnectionsRef
  ) {
    this.sseRef.getCount = () => this.#countConnections();
  }

  getOrCreateStream(
    userId: string,
    connectionId: string
  ): Subject<MessageEvent> {
    if (!this.#connections.has(userId)) {
      this.#connections.set(userId, new Map());
    }
    const subject = new Subject<MessageEvent>();
    this.#connections.get(userId)!.set(connectionId, subject);
    return subject;
  }

  closeStream(userId: string, connectionId: string): void {
    const userConnections = this.#connections.get(userId);
    if (!userConnections) return;
    const subject = userConnections.get(connectionId);
    if (subject) {
      subject.complete();
      userConnections.delete(connectionId);
    }
    if (userConnections.size === 0) {
      this.#connections.delete(userId);
    }
  }

  #countConnections(): number {
    let count = 0;
    for (const userConns of this.#connections.values()) {
      count += userConns.size;
    }
    return count;
  }

  push(userId: string, event: NotificationEvent): void {
    const userConnections = this.#connections.get(userId);
    if (!userConnections) return;
    const message: MessageEvent = { data: event };
    for (const subject of userConnections.values()) {
      subject.next(message);
    }
  }

  pushToAll(event: NotificationEvent): void {
    const message: MessageEvent = { data: event };
    for (const userConnections of this.#connections.values()) {
      for (const subject of userConnections.values()) {
        subject.next(message);
      }
    }
  }
}
