import { Inject, Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
import type { NotificationEvent } from '@app/shared/types';
import {
  SSE_CONNECTIONS_REF,
  type SseConnectionsRef
} from '../core/metrics/metrics.module';
import { PermissionService } from '../auth/services/permission.service';
import { CaslAbilityFactory } from '../auth/casl/casl-ability.factory';
import type { PermissionCheck } from '../auth/casl/app-ability';

@Injectable()
export class NotificationsService {
  readonly #connections = new Map<string, Map<string, Subject<MessageEvent>>>();
  readonly #logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(SSE_CONNECTIONS_REF) private readonly sseRef: SseConnectionsRef,
    private readonly permissionService: PermissionService,
    private readonly caslAbilityFactory: CaslAbilityFactory
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

  /**
   * Deliver only to connected users whose current abilities satisfy `check`.
   * Abilities are resolved per push (not cached on the connection) so a
   * permission change takes effect on the next event rather than on reconnect.
   */
  async pushToAuthorized(
    event: NotificationEvent,
    check: PermissionCheck
  ): Promise<void> {
    const userIds = Array.from(this.#connections.keys());
    await Promise.all(
      userIds.map(async (userId) => {
        if (await this.#can(userId, check)) {
          this.push(userId, event);
        }
      })
    );
  }

  async #can(
    userId: string,
    [action, subject]: PermissionCheck
  ): Promise<boolean> {
    try {
      const [roles, permissions] = await Promise.all([
        this.permissionService.getRolesForUser(userId),
        this.permissionService.getPermissionsForUser(userId)
      ]);
      const ability = await this.caslAbilityFactory.createForUser(
        userId,
        roles,
        permissions
      );
      return ability.can(action, subject);
    } catch (error) {
      // Fail closed: an unresolvable ability must not widen the audience
      this.#logger.warn(
        `Ability resolution failed for user ${userId} - skipping notification: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }
}
