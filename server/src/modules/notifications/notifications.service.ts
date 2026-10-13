import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger
} from '@nestjs/common';
import {
  exhaustMap,
  finalize,
  interval,
  map,
  merge,
  Observable,
  startWith,
  Subject,
  takeWhile
} from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
import type { NotificationEvent } from '@app/shared/types';
import { MAX_SSE_STREAMS_PER_USER } from '@app/shared/constants';
import {
  SSE_CONNECTIONS_REF,
  type SseConnectionsRef
} from '../core/metrics/metrics.module';
import { CaslAbilityFactory } from '../auth/casl/casl-ability.factory';
import type { AppAbility } from '../auth/casl/app-ability';
import { RefreshTokenService } from '../auth/services/refresh-token.service';
import { SSE_HEARTBEAT_INTERVAL_MS } from './notifications.constants';
import { NotificationsBus } from './notifications-bus';
import type { BusPush } from './notifications-bus';

@Injectable()
export class NotificationsService {
  readonly #connections = new Map<string, Map<string, Subject<MessageEvent>>>();
  readonly #logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(SSE_CONNECTIONS_REF) private readonly sseRef: SseConnectionsRef,
    private readonly caslAbilityFactory: CaslAbilityFactory,
    private readonly refreshTokenService: RefreshTokenService,
    @Inject(SSE_HEARTBEAT_INTERVAL_MS)
    private readonly heartbeatIntervalMs: number,
    private readonly bus: NotificationsBus
  ) {
    this.sseRef.getCount = () => this.#countConnections();
    this.bus.attach({
      deliver: (push) => this.#deliver(push),
      localUserIds: () => Array.from(this.#connections.keys())
    });
  }

  /**
   * The events of one connection and a heartbeat that also checks the session.
   * The stream is authenticated only when it opens, so without the check an
   * ended session keeps receiving events. A dead session gets
   * `session_invalidated` as the last frame, then the stream completes.
   */
  openStream(
    userId: string,
    sessionId: string,
    connectionId: string
  ): Observable<MessageEvent> {
    if (
      (this.#connections.get(userId)?.size ?? 0) >= MAX_SSE_STREAMS_PER_USER
    ) {
      // eslint-disable-next-line no-restricted-syntax -- the stream request is silent; no user sees this text
      throw new HttpException(
        'Too many open notification streams',
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    const subject = this.createStream(userId, connectionId);
    const heartbeat$ = interval(this.heartbeatIntervalMs).pipe(
      exhaustMap(() => this.#isSessionLive(sessionId)),
      takeWhile((live) => live, true),
      map((live): MessageEvent =>
        live
          ? { data: '' }
          : {
              data: {
                type: 'session_invalidated',
                userId
              } satisfies NotificationEvent
            }
      ),
      // The merge completes only when the subject completes too.
      finalize(() => this.closeStream(userId, connectionId))
    );
    // The first frame tells the client at once that the stream is live, so it
    // can reload what it missed while it was not connected.
    return merge(subject.asObservable(), heartbeat$).pipe(
      startWith<MessageEvent>({ data: '' })
    );
  }

  async #isSessionLive(sessionId: string): Promise<boolean> {
    try {
      return await this.refreshTokenService.hasLiveSession(sessionId);
    } catch (error) {
      // Keep the stream on a failed read: ending every stream at once would
      // make every client reconnect at the same moment. HTTP requests of the
      // session still fail on their own check.
      this.#logger.warn(
        `Session check failed for the stream of session ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return true;
    }
  }

  createStream(userId: string, connectionId: string): Subject<MessageEvent> {
    if (!this.#connections.has(userId)) {
      this.#connections.set(userId, new Map());
      this.bus.userConnected(userId);
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
      this.bus.userDisconnected(userId);
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
    this.#send({ userIds: [userId], event });
  }

  pushToAll(event: NotificationEvent): void {
    this.#send({ event });
  }

  /**
   * Deliver only to connected users whose current abilities satisfy `allows`.
   * Abilities are resolved per push (not cached on the connection) so a
   * permission change takes effect on the next event rather than on reconnect.
   * The check runs here for the users of every instance, so only user IDs
   * cross to the other instances.
   */
  async pushToAuthorized(
    event: NotificationEvent,
    allows: (ability: AppAbility) => boolean
  ): Promise<void> {
    const userIds = new Set([
      ...this.#connections.keys(),
      ...((await this.bus.connectedUserIds()) ?? [])
    ]);
    const allowed = await Promise.all(
      Array.from(userIds, async (userId) =>
        (await this.#can(userId, allows)) ? userId : null
      )
    );
    const recipients = allowed.filter((userId) => userId !== null);
    if (recipients.length > 0) {
      this.#send({ userIds: recipients, event });
    }
  }

  #send(push: BusPush): void {
    this.#deliver(push);
    this.bus.publish(push);
  }

  #deliver({ userIds, event }: BusPush): void {
    const message: MessageEvent = { data: event };
    const targets = userIds
      ? userIds.map((userId) => this.#connections.get(userId))
      : this.#connections.values();
    for (const userConnections of targets) {
      for (const subject of userConnections?.values() ?? []) {
        subject.next(message);
      }
    }
  }

  async #can(
    userId: string,
    allows: (ability: AppAbility) => boolean
  ): Promise<boolean> {
    try {
      const { ability } = await this.caslAbilityFactory.resolveForUser(userId);
      return allows(ability);
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
