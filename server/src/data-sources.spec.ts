import {
  SETTINGS_ENTITIES,
  inBothSources,
  regionalEntities,
  splitPoolMax
} from './data-sources';
import { dataSourceDouble } from './common/testing/data-source.double';
import { Plan } from './modules/billing/entities/plan.entity';
import { Product } from './modules/billing/entities/product.entity';
import { Action } from './modules/auth/entities/action.entity';
import { Permission } from './modules/auth/entities/permission.entity';
import { Resource } from './modules/auth/entities/resource.entity';
import { RolePermission } from './modules/auth/entities/role-permission.entity';
import { Role } from './modules/auth/entities/role.entity';
import { FeatureFlagRuleUser } from './modules/feature-flags/entities/feature-flag-rule-user.entity';
import { FeatureFlagRule } from './modules/feature-flags/entities/feature-flag-rule.entity';
import { FeatureFlag } from './modules/feature-flags/entities/feature-flag.entity';
import { UserRole } from './modules/users/entities/user-role.entity';
import { loadEntities } from './postgres.config';

describe('data sources', () => {
  describe('splitPoolMax', () => {
    it.each([
      [2, { regional: 1, settings: 1 }],
      [5, { regional: 4, settings: 1 }],
      [10, { regional: 8, settings: 2 }],
      [32, { regional: 26, settings: 6 }]
    ])('divides %i connections with no extra one', (max, sizes) => {
      expect(splitPoolMax(max)).toEqual(sizes);
    });
  });

  describe('inBothSources', () => {
    /** Two fake sources that record each commit and rollback in order. */
    function sources() {
      const events: string[] = [];
      const settings = dataSourceDouble({ name: 'settings' });
      const regional = {
        transaction: jest.fn(
          async (run: (em: { name: string }) => Promise<unknown>) => {
            try {
              const result = await run({ name: 'regional' });

              events.push('regional commit');

              return result;
            } catch (error) {
              events.push('regional rollback');

              throw error;
            }
          }
        )
      };
      const runner = () => settings.runners[0];

      settings.createQueryRunner.mockImplementationOnce(() => {
        const created = dataSourceDouble({
          name: 'settings'
        }).createQueryRunner();

        created.commitTransaction.mockImplementation(() => {
          created.isTransactionActive = false;
          events.push('settings commit');

          return Promise.resolve();
        });
        created.rollbackTransaction.mockImplementation(() => {
          created.isTransactionActive = false;
          events.push('settings rollback');

          return Promise.resolve();
        });
        settings.runners.push(created);

        return created;
      });

      return {
        events,
        runner,
        // @ts-expect-error - partial DataSource doubles: transaction and query runners only
        pair: { regional, settings } as Parameters<typeof inBothSources>[0]
      };
    }

    it.each([
      ['settings', ['settings commit', 'regional commit']],
      ['regional', ['regional commit', 'settings commit']]
    ] as const)(
      'commits %s first and releases the settings connection',
      async (commitFirst, order) => {
        const { events, runner, pair } = sources();

        await expect(
          inBothSources(pair, { commitFirst }, (managers) =>
            Promise.resolve(managers)
          )
        ).resolves.toEqual({
          regional: { name: 'regional' },
          settings: { name: 'settings' }
        });
        expect(events).toEqual(order);
        expect(runner().release).toHaveBeenCalledTimes(1);
      }
    );

    it('rolls both back when the write fails', async () => {
      const { events, runner, pair } = sources();

      await expect(
        inBothSources(pair, { commitFirst: 'settings' }, () =>
          Promise.reject(new Error('write failed'))
        )
      ).rejects.toThrow('write failed');
      expect(events).toEqual(['regional rollback', 'settings rollback']);
      expect(runner().release).toHaveBeenCalledTimes(1);
    });
  });

  describe('regionalEntities', () => {
    it('gives each entity to exactly one data source', () => {
      const all = loadEntities();
      const regional = regionalEntities(all);

      expect(SETTINGS_ENTITIES).toEqual([
        Plan,
        Product,
        Role,
        Permission,
        RolePermission,
        Resource,
        Action,
        FeatureFlag,
        FeatureFlagRule
      ]);
      expect(regional.filter((e) => SETTINGS_ENTITIES.includes(e))).toEqual([]);
      expect(regional).toContain(UserRole);
      expect(regional).toContain(FeatureFlagRuleUser);
      expect(regional.length + SETTINGS_ENTITIES.length).toBe(all.length);
    });
  });
});
