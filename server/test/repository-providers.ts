import type { Provider } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { SETTINGS_DATA_SOURCE, SETTINGS_ENTITIES } from '../src/data-sources';

/**
 * Provides the repository of `entity` on `ds` under the token that the app
 * injects: the `settings` data source for a settings entity, the default one
 * for every other entity.
 */
export function repositoryProvider(
  ds: DataSource,
  entity: NewableFunction
): Provider {
  return {
    provide: getRepositoryToken(
      entity,
      SETTINGS_ENTITIES.includes(entity) ? SETTINGS_DATA_SOURCE : undefined
    ),
    useValue: ds.getRepository(entity)
  };
}

/** `repositoryProvider` for each entity. */
export function repositoryProviders(
  ds: DataSource,
  entities: readonly NewableFunction[]
): Provider[] {
  return entities.map((entity) => repositoryProvider(ds, entity));
}
