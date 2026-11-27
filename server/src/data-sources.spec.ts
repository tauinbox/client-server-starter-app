import {
  SETTINGS_ENTITIES,
  deleteOrphanRows,
  inBothSources,
  regionalEntities,
  splitPoolMax
} from './data-sources';
import type { SourceManagers } from './data-sources';
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
import { RegionRegistryEntry } from './modules/core/region-registry/entities/region-registry-entry.entity';
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

  describe('deleteOrphanRows', () => {
    const SETTINGS_TABLE_NAMES = ['"roles"', '"feature_flag_rules"'];

    interface IdRow {
      id: string;
    }

    /** Managers that answer the regional ids and the settings ids found. */
    function managers({ named, found }: { named: string[]; found: string[] }) {
      const regional = {
        query: jest.fn<Promise<IdRow[]>, [string, unknown[]?]>((sql) =>
          Promise.resolve(
            sql.startsWith('SELECT') ? named.map((id) => ({ id })) : []
          )
        )
      };
      const settings = {
        query: jest.fn<Promise<IdRow[]>, [string, unknown[]?]>(() =>
          Promise.resolve(found.map((id) => ({ id })))
        )
      };
      const pair: SourceManagers = {
        // @ts-expect-error - partial manager: `deleteOrphanRows` calls only `query`
        regional,
        // @ts-expect-error - partial manager: `deleteOrphanRows` calls only `query`
        settings
      };

      return { regional, settings, pair };
    }

    it.each([
      ['roleMembers', '"user_roles"', '"roles"'],
      ['ruleMembers', '"feature_flag_rule_users"', '"feature_flag_rules"']
    ] as const)(
      'for %s reads the regional ids, checks them in the settings and deletes only the missing ones',
      async (kind, table, parent) => {
        const { regional, settings, pair } = managers({
          named: ['a', 'b', 'c'],
          found: ['b']
        });

        await deleteOrphanRows(pair, kind);

        const regionalSql = regional.query.mock.calls.map(([sql]) => sql);
        const [, [, deleted]] = regional.query.mock.calls;
        const [[settingsSql, settingsParams]] = settings.query.mock.calls;

        expect(regionalSql).toEqual([
          expect.stringContaining(`FROM ${table}`),
          expect.stringContaining(`DELETE FROM ${table}`)
        ]);
        expect(deleted).toEqual([['a', 'c']]);
        expect(settingsSql).toContain(`FROM ${parent}`);
        expect(settingsParams).toEqual([['a', 'b', 'c']]);
        // No statement joins a table of the other data source.
        expect(
          regionalSql.filter((sql) =>
            SETTINGS_TABLE_NAMES.some((name) => sql.includes(name))
          )
        ).toEqual([]);
        expect(regional.query.mock.invocationCallOrder[0]).toBeLessThan(
          settings.query.mock.invocationCallOrder[0]
        );
      }
    );

    it('deletes nothing when every settings row exists', async () => {
      const { regional, pair } = managers({ named: ['a'], found: ['a'] });

      await deleteOrphanRows(pair, 'roleMembers');

      expect(regional.query).toHaveBeenCalledTimes(1);
    });

    it('reads no settings row when no regional row names one', async () => {
      const { settings, pair } = managers({ named: [], found: [] });

      await deleteOrphanRows(pair, 'ruleMembers');

      expect(settings.query).not.toHaveBeenCalled();
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
        FeatureFlagRule,
        RegionRegistryEntry
      ]);
      expect(regional.filter((e) => SETTINGS_ENTITIES.includes(e))).toEqual([]);
      expect(regional).toContain(UserRole);
      expect(regional).toContain(FeatureFlagRuleUser);
      expect(regional.length + SETTINGS_ENTITIES.length).toBe(all.length);
    });
  });
});
