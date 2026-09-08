import { Logger } from '@nestjs/common';
import KeyvRedis from '@keyv/redis';
import type { Cache } from 'cache-manager';
import { SingleUseTokenLedger } from './single-use-token-ledger';
import { createMockCache } from '../testing/cache.mock';

describe('SingleUseTokenLedger', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('test');
    jest.spyOn(logger, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('in-memory cache (no Redis)', () => {
    it('grants the first claim and refuses the second', async () => {
      const ledger = new SingleUseTokenLedger(createMockCache(), 'p:', logger);

      await expect(ledger.claim('id-1', 1000)).resolves.toBe(true);
      await expect(ledger.claim('id-1', 1000)).resolves.toBe(false);
    });

    // The cache read and the cache write are two awaits, so a burst fired
    // between them would otherwise see "unspent" every time.
    it('grants exactly one of many simultaneous claims', async () => {
      const ledger = new SingleUseTokenLedger(createMockCache(), 'p:', logger);

      const results = await Promise.all(
        Array.from({ length: 25 }, () => ledger.claim('id-1', 1000))
      );

      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('keeps distinct ids independent', async () => {
      const ledger = new SingleUseTokenLedger(createMockCache(), 'p:', logger);

      await expect(ledger.claim('id-1', 1000)).resolves.toBe(true);
      await expect(ledger.claim('id-2', 1000)).resolves.toBe(true);
    });

    it('namespaces the key with the prefix', async () => {
      const cache = createMockCache();
      const ledger = new SingleUseTokenLedger(
        cache,
        'oauth-data:spent:',
        logger
      );

      await ledger.claim('id-1', 1234);

      expect(cache.set).toHaveBeenCalledWith(
        'oauth-data:spent:id-1',
        true,
        1234
      );
    });

    // A cache outage must not take sign-in down: the ledger hardens a signed,
    // seconds-long credential, so it degrades to the pre-ledger behaviour.
    it('fails open and warns when the cache throws', async () => {
      const cache = createMockCache();
      jest
        .spyOn(cache, 'get')
        .mockRejectedValue(new Error('cache unreachable'));
      const ledger = new SingleUseTokenLedger(cache, 'p:', logger);

      await expect(ledger.claim('id-1', 1000)).resolves.toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('cache unreachable')
      );
    });
  });

  describe('Redis-backed cache', () => {
    function cacheWithRedis(set: jest.Mock): Cache {
      const store = Object.create(KeyvRedis.prototype) as KeyvRedis<unknown>;
      Object.defineProperty(store, 'client', { value: { set } });
      const cache = createMockCache();
      Object.defineProperty(cache, 'stores', { value: [{ store }] });
      return cache;
    }

    // Two simultaneous presentations must not both read "unspent". Only a
    // conditional write can decide that, so the command shape is the assertion.
    it('claims with a single conditional write bounded by the ttl', async () => {
      const set = jest.fn().mockResolvedValue('OK');
      const ledger = new SingleUseTokenLedger(
        cacheWithRedis(set),
        'p:',
        logger
      );

      await expect(ledger.claim('id-1', 60_000)).resolves.toBe(true);
      expect(set).toHaveBeenCalledWith('p:id-1', '1', {
        condition: 'NX',
        expiration: { type: 'PX', value: 60_000 }
      });
    });

    it('refuses the claim when the key is already held', async () => {
      const set = jest.fn().mockResolvedValue(null);
      const ledger = new SingleUseTokenLedger(
        cacheWithRedis(set),
        'p:',
        logger
      );

      await expect(ledger.claim('id-1', 60_000)).resolves.toBe(false);
    });

    it('fails open and warns when Redis throws', async () => {
      const set = jest.fn().mockRejectedValue(new Error('redis down'));
      const ledger = new SingleUseTokenLedger(
        cacheWithRedis(set),
        'p:',
        logger
      );

      await expect(ledger.claim('id-1', 60_000)).resolves.toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('redis down')
      );
    });
  });
});
