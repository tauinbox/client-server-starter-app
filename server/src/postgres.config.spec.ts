import { join } from 'node:path';
import type { Logger } from 'typeorm';
import { importClassesFromDirectories } from 'typeorm/util/DirectoryExportedClassesLoader.js';
import {
  postgresConfig,
  settingsConnection,
  settingsMigrations
} from './postgres.config';

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
    const viaGlob = (...patterns: string[]) =>
      importClassesFromDirectories(
        silentLogger,
        patterns.map((pattern) => join(__dirname, pattern))
      );

    const [globEntities, globMigrations] = await Promise.all([
      viaGlob('modules/**/*.entity{.ts,.js}'),
      viaGlob('migrations/regional/*{ts,.js}')
    ]);

    expect(classNames(entities as unknown[])).toEqual(classNames(globEntities));
    expect(classNames(migrations as unknown[])).toEqual(
      classNames(globMigrations)
    );
    expect(globMigrations.length).toBeGreaterThan(0);
  });

  it('starts each set with its baseline', () => {
    const first = (classes: readonly unknown[]) =>
      classNames(classes).toSorted((a, b) =>
        a.slice(-13).localeCompare(b.slice(-13))
      )[0];
    const regional = first(postgresConfig().migrations as unknown[]);
    const settings = first(settingsMigrations());

    expect({ regional, settings }).toEqual({
      regional: 'RegionalBaseline1795600000000',
      settings: 'SettingsBaseline1795600000000'
    });
  });
});

describe('settingsConnection', () => {
  const ENV = process.env;
  const regional = {
    DB_HOST: 'regional-host',
    DB_PORT: '5432',
    DB_NAME: 'regional-db',
    DB_USER: 'regional-admin',
    DB_PASSWORD: 'regional-secret'
  };

  afterEach(() => {
    process.env = ENV;
  });

  it('uses the regional database when no SETTINGS_DB_ key is set or a key is empty', () => {
    process.env = { ...regional, SETTINGS_DB_NAME: '' };

    expect(settingsConnection()).toEqual({
      host: 'regional-host',
      port: 5432,
      database: 'regional-db',
      username: 'regional-admin',
      password: 'regional-secret'
    });
  });

  it('takes each SETTINGS_DB_ key that is set', () => {
    process.env = {
      ...regional,
      SETTINGS_DB_HOST: 'settings-host',
      SETTINGS_DB_PORT: '6432',
      SETTINGS_DB_NAME: 'settings-db',
      SETTINGS_DB_USER: 'settings-admin',
      SETTINGS_DB_PASSWORD: 'settings-secret'
    };

    expect(settingsConnection()).toEqual({
      host: 'settings-host',
      port: 6432,
      database: 'settings-db',
      username: 'settings-admin',
      password: 'settings-secret'
    });
  });
});
