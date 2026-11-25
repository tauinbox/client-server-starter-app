import { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Moves the settings tables and the function of the settings change log from
 * `public`, where the frozen history of one database left them, into the
 * `settings` schema. `SET SCHEMA` changes only the catalog: the rows, the
 * indexes, the constraints, the triggers and the owned sequences go with each
 * table. On a new database the baseline already ran in `settings` (the
 * search path of the settings set), so each move finds nothing to move. The
 * function gets its own search path, because a trigger runs with the search
 * path of the session that writes the row.
 */
const TABLES: readonly string[] = [
  'actions',
  'resources',
  'permissions',
  'roles',
  'role_permissions',
  'feature_flags',
  'feature_flag_rules',
  'plans',
  'billing_products',
  'settings_change_log',
  'settings_change_epoch'
];

export class MoveSettingsToSchema1795700000000 implements MigrationInterface {
  name = 'MoveSettingsToSchema1795700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "settings"`);

    for (const table of TABLES) {
      await queryRunner.query(
        `ALTER TABLE IF EXISTS "public"."${table}" SET SCHEMA "settings"`
      );
    }

    await queryRunner.query(
      `DO $$ BEGIN
        IF to_regprocedure('"public"."settings_change_log_write"()') IS NOT NULL THEN
          ALTER FUNCTION "public"."settings_change_log_write"() SET SCHEMA "settings";
        END IF;
      END $$`
    );
    await queryRunner.query(
      `ALTER FUNCTION "settings"."settings_change_log_write"() SET search_path = "settings"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER FUNCTION "settings"."settings_change_log_write"() RESET search_path`
    );
    await queryRunner.query(
      `ALTER FUNCTION "settings"."settings_change_log_write"() SET SCHEMA "public"`
    );

    for (const table of TABLES) {
      await queryRunner.query(
        `ALTER TABLE "settings"."${table}" SET SCHEMA "public"`
      );
    }
  }
}
