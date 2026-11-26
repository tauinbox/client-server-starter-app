import type { Provider } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { SETTINGS_ENTITIES } from '../src/data-sources';
import { repositoryToken } from '../src/common/testing/repository-token';

/** One data source of each database, as `openAdminDataSource` opens them. */
export interface TestSources {
  regional: DataSource;
  settings: DataSource;
}

/**
 * Provides the repository of `entity` under the token that the app injects,
 * on the data source of its database: the settings can have a database of
 * their own.
 */
export function repositoryProvider(
  sources: TestSources,
  entity: NewableFunction
): Provider {
  const source = SETTINGS_ENTITIES.includes(entity)
    ? sources.settings
    : sources.regional;

  return {
    provide: repositoryToken(entity),
    useValue: source.getRepository(entity)
  };
}

/** `repositoryProvider` for each entity. */
export function repositoryProviders(
  sources: TestSources,
  entities: readonly NewableFunction[]
): Provider[] {
  return entities.map((entity) => repositoryProvider(sources, entity));
}
