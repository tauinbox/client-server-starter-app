import { register } from 'prom-client';
import {
  DB_POOL_METRIC_NAME,
  createDbPoolGauge,
  readDbPoolCounts
} from './db-pool.gauge';

describe('db-pool gauge', () => {
  afterEach(() => {
    register.removeSingleMetric(DB_POOL_METRIC_NAME);
  });

  describe('readDbPoolCounts', () => {
    it('reads total/idle/waiting from a pg pool', () => {
      const source = {
        driver: { master: { totalCount: 7, idleCount: 3, waitingCount: 2 } }
      };
      expect(readDbPoolCounts(source)).toEqual({
        total: 7,
        idle: 3,
        waiting: 2
      });
    });

    it('returns null when the pool is not initialized', () => {
      expect(readDbPoolCounts({ driver: { master: undefined } })).toBeNull();
      expect(readDbPoolCounts({ driver: {} })).toBeNull();
      expect(readDbPoolCounts({ driver: undefined })).toBeNull();
      expect(readDbPoolCounts(undefined)).toBeNull();
    });

    it('returns null when the driver is not pg (no numeric counters)', () => {
      const source = { driver: { master: { query: jest.fn() } } };
      expect(readDbPoolCounts(source)).toBeNull();
    });
  });

  describe('createDbPoolGauge', () => {
    it('registers the gauge and populates labels from the pool on collect', async () => {
      const source = {
        driver: { master: { totalCount: 10, idleCount: 6, waitingCount: 1 } }
      };
      const gauge = createDbPoolGauge(source);

      const metric = await gauge.get();
      const byState = new Map(
        metric.values.map((v) => [v.labels['state'], v.value])
      );

      expect(byState.get('total')).toBe(10);
      expect(byState.get('idle')).toBe(6);
      expect(byState.get('waiting')).toBe(1);
    });

    it('emits nothing when the pool is unavailable', async () => {
      const gauge = createDbPoolGauge({ driver: {} });

      const metric = await gauge.get();

      expect(metric.values).toHaveLength(0);
    });

    it('reuses an already-registered metric', () => {
      const first = createDbPoolGauge({ driver: {} });
      const second = createDbPoolGauge({ driver: {} });

      expect(second).toBe(first);
    });
  });
});
