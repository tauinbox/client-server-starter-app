import { join } from 'node:path';
import type { Logger } from 'typeorm';
import { importClassesFromDirectories } from 'typeorm/util/DirectoryExportedClassesLoader.js';
import { postgresConfig } from './postgres.config';

const silentLogger: Logger = {
  logQuery: () => undefined,
  logQueryError: () => undefined,
  logQuerySlow: () => undefined,
  logSchemaBuild: () => undefined,
  logMigration: () => undefined,
  log: () => undefined
};

const classNames = (classes: readonly unknown[]): string[] =>
  classes
    .map((value) => (typeof value === 'function' ? value.name : String(value)))
    .toSorted();

describe('postgresConfig', () => {
  it('passes classes, not glob strings, to TypeORM', () => {
    const { entities, migrations } = postgresConfig();

    expect(Array.isArray(entities)).toBe(true);
    expect(Array.isArray(migrations)).toBe(true);
    expect(
      [...(entities as unknown[]), ...(migrations as unknown[])].filter(
        (value) => typeof value !== 'function'
      )
    ).toEqual([]);
  });

  it('loads the classes that the former glob strings loaded', async () => {
    const { entities, migrations } = postgresConfig();
    const viaGlob = (pattern: string) =>
      importClassesFromDirectories(silentLogger, [pattern]);

    const [globEntities, globMigrations] = await Promise.all([
      viaGlob(join(__dirname, 'modules/**/*.entity{.ts,.js}')),
      viaGlob(join(__dirname, 'migrations/*{ts,.js}'))
    ]);

    expect(classNames(entities as unknown[])).toEqual(classNames(globEntities));
    expect(classNames(migrations as unknown[])).toEqual(
      classNames(globMigrations)
    );
    expect(globMigrations.length).toBeGreaterThan(0);
  });
});
