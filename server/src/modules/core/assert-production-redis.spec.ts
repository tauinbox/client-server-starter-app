import { assertProductionRedis } from './assert-production-redis';

describe('assertProductionRedis', () => {
  it('refuses production with an empty REDIS_URL', () => {
    expect(() =>
      assertProductionRedis({ environment: 'production', redisUrl: '' })
    ).toThrow(/REDIS_URL is not set/);
  });

  it('refuses production with no REDIS_URL', () => {
    expect(() =>
      assertProductionRedis({ environment: 'production', redisUrl: undefined })
    ).toThrow(/REDIS_URL is not set/);
  });

  it('accepts production with a REDIS_URL', () => {
    expect(() =>
      assertProductionRedis({
        environment: 'production',
        redisUrl: 'redis://redis:6379'
      })
    ).not.toThrow();
  });

  it.each(['local', 'development', 'staging'])(
    'accepts %s with no REDIS_URL',
    (environment) => {
      expect(() =>
        assertProductionRedis({ environment, redisUrl: undefined })
      ).not.toThrow();
    }
  );
});
