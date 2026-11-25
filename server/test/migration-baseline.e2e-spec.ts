import { DataSource } from 'typeorm';
import { DATA_REGIONS, HOME_DATA_REGION } from '@app/shared/constants';
import {
  BASELINE_MIGRATIONS,
  FROZEN_MIGRATIONS
} from '../src/frozen-migration-history';
import {
  runMigrationSets,
  settingsMigrationOptions,
  SETTINGS_MIGRATIONS_TABLE,
  type MigrationSources
} from '../src/migration-sets';
import { RegionalBaseline1795600000000 } from '../src/migrations/regional/1795600000000-regional-baseline';
import { SettingsBaseline1795600000000 } from '../src/migrations/settings/1795600000000-settings-baseline';
import { FROZEN_HISTORY_SCHEMA } from '../src/database-roles';
import { postgresConfig } from '../src/postgres.config';
import { catalogDigest, describeSchema } from './schema-catalog';

// Runs only when DB_HOST is set: CI provides Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

/*
 * The digest of the catalog of a database that the 92 migrations of the
 * frozen history built (`describeSchema` on `pg_dump`-checked Postgres 18,
 * 2026-11-25). The files of that history are gone, so this is the record of
 * its schema. A baseline is applied history: change the schema with a new
 * migration, never by an edit of a baseline.
 */
const FROZEN_HISTORY_DIGEST: Record<string, string> = {
  extensions:
    '9c62f18dd6697b9e10509c5b23efe82899ee33c88e391204e26e60db07796805',
  enums: 'a751854ae27ae10441938c0df76a6cd27436344f84e4ab9543a4e1844ee3c3d6',
  functions: '075ad5673923c455d821037d9c9e9acc3c476f718c0f25fe7b4e5a22ba6ddf6a',
  sequences: '2f9b86d645b024dc0e962c4b63af99d2dbba23d3741b97fd45efa6e717049ad8',
  otherObjects:
    '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
  'table names':
    'da1b7cd7595f7bf123207f6afb2d26cd4269e92bc4f82b31718a90e4f643792f',
  'tables with rows':
    'a64f02c588b3c72b7f65cbb15697c04a4f48e31af66723adcc7e03475de6fff0',
  'table actions':
    'ae31af05271ce247c3cbadccb98a582d8bcbc95c0db328adcebc8d5fd3553e29',
  'table audit_logs':
    '9623dd6cad8a16ac5d121b6fc4dd7c650f269cccbefb994512b3096a1ced5a62',
  'table billing_consents':
    '36048c20a5461dee3a97a402e374ab75485711c30cd11781b7ed6b2b5eec0ecd',
  'table billing_credit_balances':
    '133c03ab805e5945c75ca8c54bccbb619512c230ae24b2a1dc04c0814c90b33a',
  'table billing_credit_ledger':
    '7d390a1b8dfe96e038373ffbd87cffe8ba33555f64496cd23bdd1f46fe4868f0',
  'table billing_customer_grants':
    '07c3d795e746f298364f5fca89fc941cb9f349787a31cfcc1177ac1261397298',
  'table billing_customers':
    '9ad9a2df543af751074b7e4d3c690425848c46b12a1c36a473ea3dc48bf81a90',
  'table billing_invoices':
    '0d54a14120e6a85d839e7f05177f8cb7e48ccb9bcd8d667cbca9b98e102cb492',
  'table billing_payment_methods':
    'cc1bdca1aea2b4548c30a29be5c9509c4b6b756d5401fb75c63611f4883886eb',
  'table billing_products':
    '79875e2689e44927b4990fb385e09561c3387cecb866b6021587cb4b27c47766',
  'table billing_usage_records':
    '3910986f097f2067657406f1a56837345358de50a62454904108313d41cb531c',
  'table billing_webhook_events':
    '26bc88cb6a76b700ad9af7e7a58959bfce167b9adc0f43c46d1dfe41aaffaca7',
  'table feature_flag_rule_users':
    '8fe45c98f75302e3a30ccbdb63fd321eaa05e4b9c0dab4ae5b8e44571c3347c5',
  'table feature_flag_rules':
    'a76caea655a0edbb3b3a115821fdbe77aa50c4bc00be91a402b6a9d1894bc275',
  'table feature_flags':
    '0f369641b3aee2e87d7ca3c51663882957f11e716d3166f1fc09958ab94ee6b7',
  'table oauth_accounts':
    'e47ab22d87c79f7465a819d7f8349317b794caa80b539722936fe2ccf602ee5b',
  'table permissions':
    '276578436680ca37dc7549570f59996307c2b9ce725a2fb98a4d3047af14becb',
  'table plans':
    '09e659db731ba72cc1b5e62165166f1ee4a82639ddff8445fa49fd31574f9a41',
  'table refresh_tokens':
    '58dddae09eda7a133bd3c9c22879a9351766da2c787c5e47844dda6a19a05685',
  'table resources':
    '46c88f5bbdc847a6630b1f9719b970d1c4df2cd88e1c7a091005bee06aae8835',
  'table role_permissions':
    '2e331dfb545653f331c91eaa16824464a8de3543308be43875fe89846210f1cf',
  'table roles':
    'f099b646bbed280e73510a686c16427e363d3ede3e077cd0f9ee0f911e8c93fe',
  'table settings_change_applied':
    'c68bf631f857ae5761e9e7b3902a0dfea01c38445a0de8348d398ea29739605e',
  'table settings_change_epoch':
    '1eda598f88d0928b62578d50561e7dbc502cca3b1e5780a1ce036ab2c2b8a186',
  'table settings_change_log':
    '05d7d582f6de5d1817a341f4f9228e3a95eb055e445bf47ad99a57833fab2493',
  'table subscriptions':
    '024ea487ddeff3feaa40b13ee87f0417b46e2e56c44151af95b69f925dcc3817',
  'table user_notifications':
    'd7f48d272082ec0184c02b6adf431d20d580e0c4498906fa3a9331701c0c59ca',
  'table user_roles':
    'e6868288e438ddd2c08c3b1fd68c125d0c91006184e41028064087be0b8d5212',
  'table users':
    '8b817fd1a40ed1899c6f6d057829b6fac9b0e85fb25acff234eb7dad24c85622',
  'rows actions':
    '80b8633e28078a60b5d3daaf6bf950cf475551e8a430094b082fd9ea7814fb09',
  'rows feature_flag_rules':
    'cbd5a74290ca12ae3ad738c1951849a229f503f3c01d31693457dc143bb6ff51',
  'rows feature_flags':
    '1a67accc1ad84ee6b2ff8793bc162c58c43c0e41a5980f230414d4aa2dd1f412',
  'rows permissions':
    'f00fe53de34748d034814db0101c75ead4c1eefc14870af92eb05d018f672e38',
  'rows resources':
    '3e05a90a8d0ee5618f50abec419f3899f3f67e45fbc3c62f23aef2759de1fd72',
  'rows role_permissions':
    'f2adae0c5e0b8b950f7afee84c0df2cbb6220fb1d32c6ac7d24a2dfd352fef3c',
  'rows roles':
    'a6e3d2d780e1b3f21dfb395ce4960b4808e1890b8b7fe7cf3da1dcb26a782faa',
  'rows settings_change_epoch':
    '05978e867f1a18a8b8882b34ca086723f15e8c0a5e010a7626c0969f524d7207'
};

const PROBE_DATABASE = `migration_baseline_probe_${process.pid}`;
const OTHER_REGION = DATA_REGIONS.find((region) => region !== HOME_DATA_REGION);

runWithInfra('the baselines of the two migration sets (e2e)', () => {
  const probe = { database: PROBE_DATABASE, logging: false } as const;
  const regionalOptions = { ...postgresConfig(), ...probe };
  const settingsOptions = { ...settingsMigrationOptions(), ...probe };
  // The frozen history kept every table, its migrations table included, in
  // one schema.
  const oneSchemaSettingsOptions = {
    ...settingsOptions,
    schema: FROZEN_HISTORY_SCHEMA,
    extra: { options: `-c search_path=${FROZEN_HISTORY_SCHEMA}` }
  };

  let admin: DataSource;
  let sources: MigrationSources;

  beforeAll(async () => {
    admin = new DataSource({ ...postgresConfig(), logging: false });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${PROBE_DATABASE}"`);

    sources = {
      regional: new DataSource(regionalOptions),
      settings: new DataSource(settingsOptions)
    };
    await sources.regional.initialize();
    await sources.settings.initialize();
  }, 60000);

  afterAll(async () => {
    for (const source of [sources?.settings, sources?.regional]) {
      if (source?.isInitialized) await source.destroy();
    }

    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${PROBE_DATABASE}"`);
      await admin.destroy();
    }
  });

  /** The migrations table as a database of the frozen history has it. */
  async function leaveFrozenHistory(names: readonly string[]): Promise<void> {
    await sources.regional.query('DELETE FROM "migrations"');
    await sources.settings.query(`DELETE FROM "${SETTINGS_MIGRATIONS_TABLE}"`);

    for (const name of names) {
      await sources.regional.query(
        'INSERT INTO "migrations" ("timestamp", "name") VALUES ($1, $2)',
        [Number(name.slice(-13)), name]
      );
    }
  }

  async function recordedNames(table: string): Promise<string[]> {
    const rows = await sources.regional.query<Array<{ name: string }>>(
      `SELECT "name" FROM "${table}" WHERE "name" LIKE '%Baseline%' ORDER BY 1`
    );

    return rows.map(({ name }) => name);
  }

  it('builds the schema and the rows of the frozen history', async () => {
    const migrate = async (
      options: typeof regionalOptions,
      migration: NewableFunction
    ): Promise<void> => {
      const only = new DataSource({ ...options, migrations: [migration] });

      await only.initialize();

      try {
        await only.runMigrations();
      } finally {
        await only.destroy();
      }
    };

    await migrate(regionalOptions, RegionalBaseline1795600000000);
    await migrate(oneSchemaSettingsOptions, SettingsBaseline1795600000000);

    expect(catalogDigest(await describeSchema(sources.regional))).toEqual(
      FROZEN_HISTORY_DIGEST
    );
  }, 60000);

  it('gives a database of one schema the same two schemas as a new database', async () => {
    const databases = [`${PROBE_DATABASE}_moved`, `${PROBE_DATABASE}_new`];
    const open = (database: string) => ({
      regional: new DataSource({ ...regionalOptions, database }),
      settings: new DataSource({ ...settingsOptions, database })
    });
    const catalogs: Array<{
      regional: Record<string, string>;
      settings: Record<string, string>;
    }> = [];

    try {
      for (const database of databases) {
        await admin.query(`CREATE DATABASE "${database}"`);
      }

      // The schema that the frozen history left: every table in one schema.
      const oneSchema = new DataSource({
        ...oneSchemaSettingsOptions,
        database: databases[0]
      });
      const historyRegional = new DataSource({
        ...regionalOptions,
        database: databases[0]
      });

      for (const [source, migration] of [
        [historyRegional, RegionalBaseline1795600000000],
        [oneSchema, SettingsBaseline1795600000000]
      ] as const) {
        const only = new DataSource({
          ...source.options,
          migrations: [migration]
        });

        await only.initialize();
        await only.runMigrations();
        await only.destroy();
      }

      for (const database of databases) {
        const pair = open(database);

        await pair.regional.initialize();
        await pair.settings.initialize();

        try {
          await runMigrationSets(pair, HOME_DATA_REGION);
          catalogs.push({
            regional: catalogDigest(await describeSchema(pair.regional)),
            settings: catalogDigest(await describeSchema(pair.settings))
          });
        } finally {
          await pair.settings.destroy();
          await pair.regional.destroy();
        }
      }
    } finally {
      for (const database of databases) {
        await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      }
    }

    const [moved, created] = catalogs;

    expect(moved.settings['table names']).toBeDefined();
    expect(moved).toEqual(created);
  }, 120000);

  it('records both baselines with no run on the home pool of a database of the frozen history, once', async () => {
    await leaveFrozenHistory(FROZEN_MIGRATIONS);

    await expect(
      runMigrationSets(sources, HOME_DATA_REGION)
    ).resolves.toMatchObject({
      recorded: [BASELINE_MIGRATIONS.regional, BASELINE_MIGRATIONS.settings]
    });
    await expect(
      runMigrationSets(sources, HOME_DATA_REGION)
    ).resolves.toMatchObject({ applied: [], recorded: [] });

    expect(await recordedNames('migrations')).toEqual([
      BASELINE_MIGRATIONS.regional
    ]);
    expect(await recordedNames(SETTINGS_MIGRATIONS_TABLE)).toEqual([
      BASELINE_MIGRATIONS.settings
    ]);
  }, 60000);

  it('records only the regional baseline on another pool, which then waits for the home pool', async () => {
    expect(OTHER_REGION).toBeDefined();
    await leaveFrozenHistory(FROZEN_MIGRATIONS);

    await expect(
      runMigrationSets(sources, OTHER_REGION ?? HOME_DATA_REGION)
    ).rejects.toThrow(
      `The settings schema is older than this build. Not applied: ${BASELINE_MIGRATIONS.settings}`
    );

    expect(await recordedNames('migrations')).toEqual([
      BASELINE_MIGRATIONS.regional
    ]);
    expect(await recordedNames(SETTINGS_MIGRATIONS_TABLE)).toEqual([]);
  }, 60000);

  it('stops on part of the frozen history and records nothing', async () => {
    await leaveFrozenHistory(FROZEN_MIGRATIONS.slice(0, -1));

    await expect(runMigrationSets(sources, HOME_DATA_REGION)).rejects.toThrow(
      `The database holds ${FROZEN_MIGRATIONS.length - 1} of the ${FROZEN_MIGRATIONS.length} migrations of the frozen history.`
    );

    expect(await recordedNames('migrations')).toEqual([]);
    expect(await recordedNames(SETTINGS_MIGRATIONS_TABLE)).toEqual([]);
  }, 60000);
});
