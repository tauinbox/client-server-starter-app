import type { INestApplicationContext } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { SETTINGS_DATA_SOURCE } from '../src/data-sources';

/**
 * The settings data source of `app`. A test reads and writes an entity of
 * `SETTINGS_ENTITIES` through it: the default data source has no metadata for
 * those entities.
 */
export function settingsDataSourceOf(app: INestApplicationContext): DataSource {
  return app.get<DataSource>(getDataSourceToken(SETTINGS_DATA_SOURCE));
}
