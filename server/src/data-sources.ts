import type { DataSource, EntityManager } from 'typeorm';
import { Product } from './modules/billing/entities/product.entity';
import { Plan } from './modules/billing/entities/plan.entity';
import { Action } from './modules/auth/entities/action.entity';
import { Permission } from './modules/auth/entities/permission.entity';
import { Resource } from './modules/auth/entities/resource.entity';
import { RolePermission } from './modules/auth/entities/role-permission.entity';
import { Role } from './modules/auth/entities/role.entity';
import { FeatureFlagRule } from './modules/feature-flags/entities/feature-flag-rule.entity';
import { FeatureFlag } from './modules/feature-flags/entities/feature-flag.entity';

/**
 * The name of the TypeORM data source of the settings: the rows that every
 * region shares and that hold no personal data. The default data source is
 * the regional one. Both point at the same database until the settings move
 * to their own database.
 */
export const SETTINGS_DATA_SOURCE = 'settings';

/**
 * The entities of the settings data source. The regional data source does not
 * register them, so a regional manager that reads one of them fails with
 * "No metadata" instead of reading a database that will not hold it.
 */
export const SETTINGS_ENTITIES: readonly NewableFunction[] = [
  Plan,
  Product,
  Role,
  Permission,
  RolePermission,
  Resource,
  Action,
  FeatureFlag,
  FeatureFlagRule
];

/**
 * The settings transaction committed and the regional one then failed: the
 * settings change is applied. `cause` is the failure of the regional commit.
 */
export class SettingsCommittedError extends Error {
  constructor(readonly cause: unknown) {
    super('The settings commit applied, then the regional commit failed');
  }
}

/** One manager of each data source. */
export interface SourceManagers {
  regional: EntityManager;
  settings: EntityManager;
}

/**
 * Runs `run` in a transaction of each data source. The regional connection is
 * taken first, on every path that holds both: two requests that took the two
 * pools in opposite orders could each wait for the other until the connection
 * timeout. `commitFirst` names the transaction of the row that the other one
 * points at: a new settings row commits before the regional rows that name it,
 * else the apply of the change log can delete them as orphans in between; a
 * locked settings row stays locked until the regional rows that name it commit.
 */
export async function inBothSources<T>(
  sources: { regional: DataSource; settings: DataSource },
  { commitFirst }: { commitFirst: keyof SourceManagers },
  run: (managers: SourceManagers) => Promise<T>
): Promise<T> {
  const settings = sources.settings.createQueryRunner();
  let settingsCommitted = false;

  try {
    // The regional transaction commits when its callback returns.
    const result = await sources.regional.transaction(async (regional) => {
      await settings.connect();
      await settings.startTransaction();
      const written = await run({ regional, settings: settings.manager });

      if (commitFirst === 'settings') {
        await settings.commitTransaction();
        settingsCommitted = true;
      }

      return written;
    });

    if (commitFirst === 'regional') await settings.commitTransaction();

    return result;
  } catch (error) {
    if (settings.isTransactionActive) await settings.rollbackTransaction();

    throw settingsCommitted ? new SettingsCommittedError(error) : error;
  } finally {
    await settings.release();
  }
}

/**
 * The regional rows that point at a settings row by a plain id, with no
 * foreign key: the apply of the settings change log deletes the rows whose
 * settings row is gone. One closed list, because each name goes into SQL.
 */
const REGIONAL_CHILD_ROWS = {
  roleMembers: { table: 'user_roles', column: 'role_id', parent: 'roles' },
  ruleMembers: {
    table: 'feature_flag_rule_users',
    column: 'rule_id',
    parent: 'feature_flag_rules'
  }
} as const;

/**
 * Deletes the regional rows of `kind` whose settings row does not exist. The
 * regional ids are read first and checked in the settings second: a settings
 * write commits its new row before the regional rows that name it
 * (`writeSettings`), so each row that the first read sees names a committed
 * settings row. The reverse order could miss a new settings row and delete
 * its new regional rows.
 */
export async function deleteOrphanRows(
  { regional, settings }: SourceManagers,
  kind: keyof typeof REGIONAL_CHILD_ROWS
): Promise<void> {
  const { table, column, parent } = REGIONAL_CHILD_ROWS[kind];
  const named = await regional.query<Array<{ id: string }>>(
    `SELECT DISTINCT "${column}" AS "id" FROM "${table}"`
  );

  if (named.length === 0) return;

  const ids = named.map(({ id }) => id);
  const found = await settings.query<Array<{ id: string }>>(
    `SELECT "id" FROM "${parent}" WHERE "id" = ANY($1::uuid[])`,
    [ids]
  );
  const live = new Set(found.map(({ id }) => id));
  const missing = ids.filter((id) => !live.has(id));

  if (missing.length === 0) return;

  await regional.query(
    `DELETE FROM "${table}" WHERE "${column}" = ANY($1::uuid[])`,
    [missing]
  );
}

/** The settings pool takes this share of `DB_POOL_MAX`, at least 1. */
const SETTINGS_POOL_SHARE = 0.2;

export interface PoolSizes {
  regional: number;
  settings: number;
}

/**
 * Divides one connection budget between the two pools. The sum stays
 * `DB_POOL_MAX`, because each connection is a Postgres process inside the
 * memory limit of the database container.
 */
export function splitPoolMax(max: number): PoolSizes {
  const settings = Math.max(1, Math.floor(max * SETTINGS_POOL_SHARE));

  return { regional: max - settings, settings };
}

/** The entities of the regional data source: every entity of `all` that is not a settings entity. */
export function regionalEntities(
  all: readonly NewableFunction[]
): NewableFunction[] {
  return all.filter((entity) => !SETTINGS_ENTITIES.includes(entity));
}
