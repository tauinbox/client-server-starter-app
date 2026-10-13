import type { NotificationEvent } from '@app/shared/types';

/** A push for the connections of all instances. No `userIds` means every connection. */
export interface BusPush {
  userIds?: string[];
  event: NotificationEvent;
}

/** What the bus needs from the instance that owns the connections. */
export interface BusPeer {
  deliver(push: BusPush): void;
  localUserIds(): string[];
}

/**
 * Carries pushes between server instances. An instance delivers a push to its
 * own connections, then publishes it here for the other instances.
 */
export abstract class NotificationsBus {
  abstract attach(peer: BusPeer): void;
  abstract publish(push: BusPush): void;
  abstract userConnected(userId: string): void;
  abstract userDisconnected(userId: string): void;
  /** Users with a stream on any instance, or null when only this instance is known. */
  abstract connectedUserIds(): Promise<string[] | null>;
}

/** One instance: the connections of this process are all the connections. */
export class LocalNotificationsBus extends NotificationsBus {
  attach(): void {
    return;
  }

  publish(): void {
    return;
  }

  userConnected(): void {
    return;
  }

  userDisconnected(): void {
    return;
  }

  connectedUserIds(): Promise<null> {
    return Promise.resolve(null);
  }
}
