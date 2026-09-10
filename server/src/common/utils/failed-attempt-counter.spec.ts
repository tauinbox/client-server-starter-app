import { Logger } from '@nestjs/common';
import KeyvRedis from '@keyv/redis';
import type { Cache } from 'cache-manager';
import { FailedAttemptCounter } from './failed-attempt-counter';
import { createMockCache } from '../testing/cache.mock';

describe('FailedAttemptCounter', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('test');
    jest.spyOn(logger, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('in-memory fallback (no Redis)', () => {
    it('counts every failure against the same subject', async () => {
      const counter = new FailedAttemptCounter(createMockCache(), 'p:', logger);

      await expect(counter.record('id-1', 1000)).resolves.toMatchObject({
        count: 1
      });
      await expect(counter.record('id-1', 1000)).resolves.toMatchObject({
        count: 2
      });
    });

    it('keeps distinct subjects independent', async () => {
      const counter = new FailedAttemptCounter(createMockCache(), 'p:', logger);

      await counter.record('id-1', 1000);
      await expect(counter.record('id-2', 1000)).resolves.toMatchObject({
        count: 1
      });
    });

    // A burst fired at one account is the attack this counter exists to bound,
    // so no increment may be lost between two awaits.
    it('counts every request of a simultaneous burst', async () => {
      const counter = new FailedAttemptCounter(createMockCache(), 'p:', logger);

      const windows = await Promise.all(
        Array.from({ length: 25 }, () => counter.record('id-1', 1000))
      );

      expect(Math.max(...windows.map((w) => w.count))).toBe(25);
    });

    it('reads the open window without counting anything', async () => {
      const counter = new FailedAttemptCounter(createMockCache(), 'p:', logger);

      await counter.record('id-1', 1000);
      await expect(counter.read('id-1')).resolves.toMatchObject({ count: 1 });
      await expect(counter.read('id-1')).resolves.toMatchObject({ count: 1 });
    });

    it('reports no window for a subject that never failed', async () => {
      const counter = new FailedAttemptCounter(createMockCache(), 'p:', logger);

      await expect(counter.read('id-1')).resolves.toEqual({
        count: 0,
        remainingMs: 0
      });
    });

    it('starts a new window once the old one elapses', async () => {
      const counter = new FailedAttemptCounter(createMockCache(), 'p:', logger);

      await counter.record('id-1', 20);
      await counter.record('id-1', 20);
      await new Promise((resolve) => setTimeout(resolve, 40));

      await expect(counter.read('id-1')).resolves.toMatchObject({ count: 0 });
      await expect(counter.record('id-1', 20)).resolves.toMatchObject({
        count: 1
      });
    });

    // The window is set when it opens and never extended, so a subject that
    // keeps trying cannot be held past the duration the caller asked for.
    it('does not extend the window on a later failure', async () => {
      const counter = new FailedAttemptCounter(createMockCache(), 'p:', logger);

      const first = await counter.record('id-1', 1000);
      const second = await counter.record('id-1', 1000);

      expect(second.remainingMs).toBeLessThanOrEqual(first.remainingMs);
    });

    it('closes the window on clear', async () => {
      const counter = new FailedAttemptCounter(createMockCache(), 'p:', logger);

      await counter.record('id-1', 1000);
      await counter.clear('id-1');

      await expect(counter.read('id-1')).resolves.toMatchObject({ count: 0 });
    });
  });

  describe('Redis-backed cache', () => {
    function cacheWithRedis(client: Record<string, jest.Mock>): Cache {
      const store = Object.create(KeyvRedis.prototype) as KeyvRedis<unknown>;
      Object.defineProperty(store, 'client', { value: client });
      const cache = createMockCache();
      Object.defineProperty(cache, 'stores', { value: [{ store }] });
      return cache;
    }

    // The expiry is written by the command that creates the key. An `INCR`
    // that lands before a separate `PEXPIRE` fails would leave a counter with
    // no expiry, which bars the subject for ever.
    it('opens the window with a conditional write that carries the expiry', async () => {
      const client = {
        set: jest.fn().mockResolvedValue('OK'),
        incr: jest.fn().mockResolvedValue(1),
        pTTL: jest.fn().mockResolvedValue(59_000)
      };
      const counter = new FailedAttemptCounter(
        cacheWithRedis(client),
        'p:',
        logger
      );

      await expect(counter.record('id-1', 60_000)).resolves.toEqual({
        count: 1,
        remainingMs: 59_000
      });
      expect(client.set).toHaveBeenCalledWith('p:id-1', '0', {
        condition: 'NX',
        expiration: { type: 'PX', value: 60_000 }
      });
      expect(client.incr).toHaveBeenCalledWith('p:id-1');
    });

    it('reads the count and the time left without counting', async () => {
      const client = {
        get: jest.fn().mockResolvedValue('4'),
        pTTL: jest.fn().mockResolvedValue(12_000)
      };
      const counter = new FailedAttemptCounter(
        cacheWithRedis(client),
        'p:',
        logger
      );

      await expect(counter.read('id-1')).resolves.toEqual({
        count: 4,
        remainingMs: 12_000
      });
    });

    // -1 is a key with no expiry and -2 a key that is gone. Neither is a window.
    it('reports no time left when the key carries no expiry', async () => {
      const client = {
        get: jest.fn().mockResolvedValue('4'),
        pTTL: jest.fn().mockResolvedValue(-1)
      };
      const counter = new FailedAttemptCounter(
        cacheWithRedis(client),
        'p:',
        logger
      );

      await expect(counter.read('id-1')).resolves.toEqual({
        count: 4,
        remainingMs: 0
      });
    });

    it('fails open and warns when Redis throws', async () => {
      const client = {
        set: jest.fn().mockRejectedValue(new Error('redis down')),
        get: jest.fn().mockRejectedValue(new Error('redis down')),
        incr: jest.fn(),
        pTTL: jest.fn()
      };
      const counter = new FailedAttemptCounter(
        cacheWithRedis(client),
        'p:',
        logger
      );

      await expect(counter.record('id-1', 60_000)).resolves.toEqual({
        count: 0,
        remainingMs: 0
      });
      await expect(counter.read('id-1')).resolves.toEqual({
        count: 0,
        remainingMs: 0
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('redis down')
      );
    });

    it('deletes the key on clear', async () => {
      const client = { del: jest.fn().mockResolvedValue(1) };
      const counter = new FailedAttemptCounter(
        cacheWithRedis(client),
        'p:',
        logger
      );

      await counter.clear('id-1');

      expect(client.del).toHaveBeenCalledWith('p:id-1');
    });
  });
});
