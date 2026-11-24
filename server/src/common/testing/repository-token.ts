import { getRepositoryToken } from '@nestjs/typeorm';
import { SETTINGS_DATA_SOURCE, SETTINGS_ENTITIES } from '../../data-sources';

/**
 * The token under which the app injects the repository of `entity`: the
 * `settings` data source for a settings entity, the default one for every
 * other entity. A test that takes the token from here needs no edit when an
 * entity moves between data sources.
 */
export function repositoryToken(
  entity: NewableFunction
): ReturnType<typeof getRepositoryToken> {
  return getRepositoryToken(
    entity,
    SETTINGS_ENTITIES.includes(entity) ? SETTINGS_DATA_SOURCE : undefined
  );
}
