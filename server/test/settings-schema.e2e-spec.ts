import { DataSource, MigrationInterface } from 'typeorm';
import { DATA_REGIONS, HOME_DATA_REGION } from '@app/shared/constants';
import { postgresConfig } from '../src/postgres.config';
import {
  runMigrationSets,
  settingsMigrationOptions,
  type MigrationSources
} from '../src/migration-sets';

// Runs only when DB_HOST is set: CI provides Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

// An own migrations table, so the probe does not touch the settings set of
// the shared e2e database.
const PROBE_TABLE = `settings_migrations_probe_${process.pid}`;

class SettingsSchemaProbe1999999999998 implements MigrationInterface {
  name = 'SettingsSchemaProbe1999999999998';

  async up(): Promise<void> {}

  async down(): Promise<void> {}
}

const OTHER_REGION = DATA_REGIONS.find((region) => region !== HOME_DATA_REGION);

runWithInfra('settings schema version of a pool (e2e)', () => {
  let sources: MigrationSources;

  beforeAll(async () => {
    sources = {
      regional: new DataSource({
        ...postgresConfig(),
        logging: false,
        migrations: []
      }),
      settings: new DataSource({
        ...settingsMigrationOptions(),
        logging: false,
        migrations: [SettingsSchemaProbe1999999999998],
        migrationsTableName: PROBE_TABLE
      })
    };
    await sources.regional.initialize();
    await sources.settings.initialize();
  }, 60000);

  afterAll(async () => {
    if (sources?.settings.isInitialized) {
      await sources.settings.query(`DROP TABLE IF EXISTS "${PROBE_TABLE}"`);
      await sources.settings.destroy();
    }

    if (sources?.regional.isInitialized) await sources.regional.destroy();
  });

  it('refuses to start a non-home pool on an older settings schema, and runs no settings migration there', async () => {
    expect(OTHER_REGION).toBeDefined();

    await expect(
      runMigrationSets(sources, OTHER_REGION ?? HOME_DATA_REGION)
    ).rejects.toThrow(
      'The settings schema is older than this build. Not applied: SettingsSchemaProbe1999999999998.'
    );

    const [{ found }] = await sources.settings.query<
      Array<{ found: string | null }>
    >('SELECT to_regclass($1) AS "found"', [`"${PROBE_TABLE}"`]);

    expect(found).toBeNull();
  });

  it('applies the settings set on the home pool, then lets the other pool start', async () => {
    await expect(runMigrationSets(sources, HOME_DATA_REGION)).resolves.toEqual({
      applied: ['SettingsSchemaProbe1999999999998']
    });
    await expect(
      runMigrationSets(sources, OTHER_REGION ?? HOME_DATA_REGION)
    ).resolves.toEqual({ applied: [] });
  });
});
