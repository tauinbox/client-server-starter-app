import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { ThrottledFailureLog } from '../../common/utils/redis-client';
import { NotificationsBus } from './notifications-bus';
import type { BusPeer, BusPush } from './notifications-bus';

export const DEFAULT_BUS_NAMESPACE = 'nexus:sse';
const REGISTRY_REFRESH_MS = 30_000;
// Three missed refreshes: a crashed instance leaves the registry after this.
const REGISTRY_TTL_MS = 90_000;

interface BusMessage extends BusPush {
  origin: string;
}

/**
 * Redis pub/sub between instances, and a registry of the users that have a
 * stream on any instance. The registry is a sorted set of
 * `<instanceId>:<userId>` members scored by the time of the last refresh, so
 * the members of a crashed instance expire without a cleanup.
 *
 * The ability check of `pushToAuthorized` stays on the sending instance: it
 * reads the registry and publishes only the allowed user IDs, so no record and
 * no check crosses Redis.
 */
export class RedisNotificationsBus
  extends NotificationsBus
  implements OnModuleInit, OnModuleDestroy
{
  readonly #instanceId = randomUUID();
  readonly #logger = new Logger(RedisNotificationsBus.name);
  readonly #failureLog = new ThrottledFailureLog(
    this.#logger,
    'Notifications bus unavailable, pushes reach only the streams of this instance'
  );
  readonly #publisher: Redis;
  readonly #subscriber: Redis;
  readonly #channel: string;
  readonly #registryKey: string;
  #peer: BusPeer | null = null;
  #refreshTimer: NodeJS.Timeout | undefined;

  /** @param namespace prefix of the channel and the registry key, shared by the instances of one deployment */
  constructor(url: string, namespace = DEFAULT_BUS_NAMESPACE) {
    super();
    // Fail fast: a push must not wait for a reconnect.
    this.#publisher = new Redis(url, { maxRetriesPerRequest: 1 });
    // Keep the subscribe queued until Redis is reachable.
    this.#subscriber = new Redis(url, { maxRetriesPerRequest: null });
    this.#publisher.on('error', (error) => this.#failureLog.log(error));
    this.#subscriber.on('error', (error) => this.#failureLog.log(error));
    // Keys belong to one database, channels do not. The database index keeps
    // two deployments on one Redis apart.
    this.#channel = `${namespace}:push:${this.#publisher.options.db ?? 0}`;
    this.#registryKey = `${namespace}:users`;
  }

  attach(peer: BusPeer): void {
    this.#peer = peer;
  }

  onModuleInit(): void {
    this.#subscriber.on('message', (_channel: string, raw: string) =>
      this.#receive(raw)
    );
    this.#subscriber
      .subscribe(this.#channel)
      .catch((error: unknown) => this.#failureLog.log(error));
    this.#refreshTimer = setInterval(
      () => void this.#touch(this.#peer?.localUserIds() ?? []),
      REGISTRY_REFRESH_MS
    );
    this.#refreshTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.#refreshTimer);
    const members = (this.#peer?.localUserIds() ?? []).map((userId) =>
      this.#member(userId)
    );
    if (members.length > 0) {
      await this.#publisher
        .zrem(this.#registryKey, ...members)
        .catch((error: unknown) => this.#failureLog.log(error));
    }
    this.#subscriber.disconnect();
    this.#publisher.disconnect();
  }

  publish(push: BusPush): void {
    const message: BusMessage = { origin: this.#instanceId, ...push };
    this.#publisher
      .publish(this.#channel, JSON.stringify(message))
      .catch((error: unknown) => this.#failureLog.log(error));
  }

  userConnected(userId: string): void {
    void this.#touch([userId]);
  }

  userDisconnected(userId: string): void {
    this.#publisher
      .zrem(this.#registryKey, this.#member(userId))
      .catch((error: unknown) => this.#failureLog.log(error));
  }

  async connectedUserIds(): Promise<string[] | null> {
    try {
      const members = await this.#publisher.zrangebyscore(
        this.#registryKey,
        Date.now() - REGISTRY_TTL_MS,
        '+inf'
      );
      return members.map((member) => member.slice(member.indexOf(':') + 1));
    } catch (error) {
      this.#failureLog.log(error);
      return null;
    }
  }

  async #touch(userIds: string[]): Promise<void> {
    const now = Date.now();
    const transaction = this.#publisher
      .multi()
      .zremrangebyscore(this.#registryKey, '-inf', now - REGISTRY_TTL_MS);
    if (userIds.length > 0) {
      transaction.zadd(
        this.#registryKey,
        ...userIds.flatMap((userId) => [now, this.#member(userId)])
      );
    }
    try {
      await transaction.pexpire(this.#registryKey, REGISTRY_TTL_MS).exec();
    } catch (error) {
      this.#failureLog.log(error);
    }
  }

  #member(userId: string): string {
    return `${this.#instanceId}:${userId}`;
  }

  #receive(raw: string): void {
    let message: BusMessage;
    try {
      message = JSON.parse(raw) as BusMessage;
    } catch (error) {
      this.#failureLog.log(error);
      return;
    }
    if (message.origin === this.#instanceId) return;
    this.#peer?.deliver({ userIds: message.userIds, event: message.event });
  }
}
