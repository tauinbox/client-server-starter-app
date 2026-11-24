import { Product } from './modules/billing/entities/product.entity';
import { Plan } from './modules/billing/entities/plan.entity';

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
export const SETTINGS_ENTITIES: readonly NewableFunction[] = [Plan, Product];

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
