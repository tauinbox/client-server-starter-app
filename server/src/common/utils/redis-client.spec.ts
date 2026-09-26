import { Logger } from '@nestjs/common';
import KeyvRedis from '@keyv/redis';
import { redisClientOf, ThrottledFailureLog } from './redis-client';
import { createMockCache } from '../testing/cache.mock';

describe('redisClientOf', () => {
  it('returns the client of a Redis adapter', () => {
    const client = { get: jest.fn() };
    const store = Object.create(KeyvRedis.prototype) as KeyvRedis<unknown>;
    Object.defineProperty(store, 'client', { value: client });
    const cache = createMockCache();
    Object.defineProperty(cache, 'stores', { value: [{ store }] });

    expect(redisClientOf(cache)).toBe(client);
  });

  it('returns null for a cache with a store that is not Redis', () => {
    const cache = createMockCache();
    Object.defineProperty(cache, 'stores', { value: [{ store: new Map() }] });

    expect(redisClientOf(cache)).toBeNull();
  });

  it('returns null for a cache with an empty store list', () => {
    expect(redisClientOf(createMockCache())).toBeNull();
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
