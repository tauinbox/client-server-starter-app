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
    it('populates the labels of each pool on collect', async () => {
      const gauge = createDbPoolGauge({
        regional: {
          driver: { master: { totalCount: 8, idleCount: 6, waitingCount: 1 } }
        },
        settings: {
          driver: { master: { totalCount: 2, idleCount: 2, waitingCount: 0 } }
        }
      });

      const metric = await gauge.get();
      const values = Object.fromEntries(
        metric.values.map(({ labels, value }) => [
          `${labels['pool']}/${labels['state']}`,
          value
        ])
      );

      expect(values).toEqual({
        'regional/total': 8,
        'regional/idle': 6,
        'regional/waiting': 1,
        'settings/total': 2,
        'settings/idle': 2,
        'settings/waiting': 0
      });
    });

    it('emits nothing for a pool that is unavailable', async () => {
      const gauge = createDbPoolGauge({
        regional: {
          driver: { master: { totalCount: 8, idleCount: 6, waitingCount: 1 } }
        },
        settings: { driver: {} }
      });

      const metric = await gauge.get();

      expect(metric.values.map(({ labels }) => labels['pool'])).toEqual([
        'regional',
        'regional',
        'regional'
      ]);
    });

    it('reuses an already-registered metric', () => {
      const unavailable = {
        regional: { driver: {} },
        settings: { driver: {} }
      };
      const first = createDbPoolGauge(unavailable);
      const second = createDbPoolGauge(unavailable);

      expect(second).toBe(first);
    });
  });
});
