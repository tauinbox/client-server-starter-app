import { Logger } from '@nestjs/common';
import KeyvRedis from '@keyv/redis';
import type { Cache } from 'cache-manager';
import { redisClientOf, ThrottledFailureLog } from './redis-client';
import { createMockCache } from '../testing/cache.mock';

describe('redisClientOf', () => {
  function cacheWith(store: unknown): Cache {
    const cache = createMockCache();

    Object.defineProperty(cache, 'stores', { value: [{ store }] });

    return cache;
  }

  // The adapter connects on its first own operation. A raw command sent
  // before it fails with "The client is closed", which is what the version
  // counter hit on startup.
  it('opens the connection of an adapter that has not connected yet', async () => {
    const client: { isOpen: boolean; connect: jest.Mock; on: jest.Mock } = {
      isOpen: false,
      connect: jest.fn(),
      on: jest.fn()
    };

    client.connect.mockImplementation(() => {
      client.isOpen = true;

      return Promise.resolve(client);
    });
    const store = new KeyvRedis<unknown>('redis://localhost:6379');

    // @ts-expect-error stand-in for the node-redis client: only isOpen, connect and on are exercised
    store.client = client;

    await expect(redisClientOf(cacheWith(store))).resolves.toBe(client);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.isOpen).toBe(true);
  });

  it('returns the client of a connected adapter without a new connect', async () => {
    const client: { isOpen: boolean; connect: jest.Mock; on: jest.Mock } = {
      isOpen: true,
      connect: jest.fn(),
      on: jest.fn()
    };
    const store = new KeyvRedis<unknown>('redis://localhost:6379');

    // @ts-expect-error stand-in for the node-redis client
    store.client = client;

    await expect(redisClientOf(cacheWith(store))).resolves.toBe(client);
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('returns the closed client when the connect throws, so the command fails and the caller falls back', async () => {
    const store = Object.create(KeyvRedis.prototype) as KeyvRedis<unknown>;
    const client = { isOpen: false };

    Object.defineProperty(store, 'client', { value: client });
    Object.defineProperty(store, 'getClient', {
      value: jest.fn().mockRejectedValue(new Error('connect failed'))
    });

    await expect(redisClientOf(cacheWith(store))).resolves.toBe(client);
  });

  it('returns null for a cache with a store that is not Redis', async () => {
    await expect(redisClientOf(cacheWith(new Map()))).resolves.toBeNull();
  });

  it('returns null for a cache with an empty store list', async () => {
    await expect(redisClientOf(createMockCache())).resolves.toBeNull();
  });
});

describe('ThrottledFailureLog', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('test');
    jest.spyOn(logger, 'warn').mockImplementation();
    jest.useFakeTimers({ now: 1_000_000 });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('writes the message followed by the error text', () => {
    new ThrottledFailureLog(logger, 'Counter unavailable').log(
      new Error('ECONNREFUSED')
    );

    expect(logger.warn).toHaveBeenCalledWith(
      'Counter unavailable: ECONNREFUSED'
    );
  });

  it('writes a non-Error value as a string', () => {
    new ThrottledFailureLog(logger, 'Counter unavailable').log('timeout');

    expect(logger.warn).toHaveBeenCalledWith('Counter unavailable: timeout');
  });

  it('writes one line per 30 seconds during an outage', () => {
    const log = new ThrottledFailureLog(logger, 'Counter unavailable');

    log.log(new Error('first'));
    jest.advanceTimersByTime(29_999);
    log.log(new Error('suppressed'));
    jest.advanceTimersByTime(1);
    log.log(new Error('second'));

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenLastCalledWith('Counter unavailable: second');
  });
});
