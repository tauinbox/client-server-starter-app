import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { SETTINGS_SCHEMA, SOURCE_ROLES } from '../src/database-roles';
import { CoreModule } from '../src/modules/core/core.module';
import { stopSettingsPoll } from './settings-poll';
import { settingsDataSourceOf } from './settings-data-source';

// Runs only when DB_HOST is set: CI provides Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

/*
 * Each data source of the server logs in with its own role, which reads and
 * writes only the rows of its own schema. A statement that joins the two
 * schemas fails here, as it will after the settings move to their own
 * database, and no role of the server can change the schema.
 */
runWithInfra('the database role of each data source (e2e)', () => {
  let app: INestApplication;
  let regional: DataSource;
  let settings: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    stopSettingsPoll(app);
    regional = app.get(DataSource);
    settings = settingsDataSourceOf(app);
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  const whoAmI = async (source: DataSource) => {
    const [row] = await source.query<
      Array<{ role: string; superuser: string }>
    >(
      `SELECT current_user AS "role", current_setting('is_superuser') AS "superuser"`
    );

    return row;
  };

  it('logs in each data source with its own role, which is not a superuser', async () => {
    await expect(whoAmI(regional)).resolves.toEqual({
      role: SOURCE_ROLES.regional.role,
      superuser: 'off'
    });
    await expect(whoAmI(settings)).resolves.toEqual({
      role: SOURCE_ROLES.settings.role,
      superuser: 'off'
    });
  });

  it('refuses a read of the other schema', async () => {
    await expect(
      regional.query(`SELECT 1 FROM "${SETTINGS_SCHEMA}"."roles" LIMIT 1`)
    ).rejects.toThrow(`permission denied for schema ${SETTINGS_SCHEMA}`);
    await expect(
      settings.query('SELECT 1 FROM "public"."users" LIMIT 1')
    ).rejects.toThrow('permission denied for table users');
  });

  it('refuses a statement that joins a regional table to a settings table', async () => {
    await expect(
      regional.query(
        `SELECT 1 FROM "user_roles" ur JOIN "${SETTINGS_SCHEMA}"."roles" r ON r."id" = ur."role_id" LIMIT 1`
      )
    ).rejects.toThrow(`permission denied for schema ${SETTINGS_SCHEMA}`);
    await expect(
      settings.query(
        'SELECT 1 FROM "roles" r JOIN "public"."user_roles" ur ON ur."role_id" = r."id" LIMIT 1'
      )
    ).rejects.toThrow('permission denied for table user_roles');
  });

  it('refuses a read of the migrations tables and any change of the schema', async () => {
    await expect(
      regional.query('SELECT 1 FROM "migrations" LIMIT 1')
    ).rejects.toThrow('permission denied for table migrations');
    await expect(
      settings.query('SELECT 1 FROM "settings_migrations" LIMIT 1')
    ).rejects.toThrow('permission denied for table settings_migrations');
    await expect(
      regional.query('CREATE TABLE "database_roles_probe" ("id" int)')
    ).rejects.toThrow('permission denied for schema public');
    await expect(
      settings.query('CREATE TABLE "database_roles_probe" ("id" int)')
    ).rejects.toThrow(`permission denied for schema ${SETTINGS_SCHEMA}`);
    await expect(regional.query('DROP TABLE "users"')).rejects.toThrow(
      'must be owner of table users'
    );
  });
});
