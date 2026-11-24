import type { Provider } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { repositoryToken } from '../src/common/testing/repository-token';

/** Provides the repository of `entity` on `ds` under the token that the app injects. */
export function repositoryProvider(
  ds: DataSource,
  entity: NewableFunction
): Provider {
  return {
    provide: repositoryToken(entity),
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
