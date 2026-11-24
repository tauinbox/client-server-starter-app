import { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Each settings table gets a row trigger and a TRUNCATE statement trigger: a
 * row trigger does not fire on TRUNCATE. The first trigger argument is the
 * column that the log keeps for each row; the others are columns whose change
 * alone writes no entry. The trigger takes the log lock before `nextval`, so
 * the versions commit in their order and a reader of `version > applied`
 * cannot pass a version that commits later.
 */
const LOGGED_TABLES: ReadonlyArray<{ table: string; args: string[] }> = [
  { table: 'roles', args: ['id', 'updated_at'] },
  { table: 'role_permissions', args: ['role_id'] },
  { table: 'permissions', args: ['id'] },
  { table: 'resources', args: ['id', 'last_synced_at'] },
  { table: 'actions', args: ['id'] },
  { table: 'feature_flags', args: ['id', 'updated_at'] },
  { table: 'feature_flag_rules', args: ['flag_id', 'updated_at'] },
  { table: 'plans', args: ['id', 'updated_at'] },
  { table: 'billing_products', args: ['id', 'updated_at'] }
];

export class AddSettingsChangeLog1795495958080 implements MigrationInterface {
  name = 'AddSettingsChangeLog1795495958080';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT "FK_user_roles_role"`
    );
    await queryRunner.query(`
      CREATE TABLE "settings_change_log" (
        "version" bigserial NOT NULL,
        "table_name" text NOT NULL,
        "operation" text NOT NULL,
        "keys" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_settings_change_log" PRIMARY KEY ("version")
      )`);
    await queryRunner.query(`
      CREATE TABLE "settings_change_epoch" (
        "id" smallint NOT NULL DEFAULT 1,
        "epoch" uuid NOT NULL DEFAULT gen_random_uuid(),
        CONSTRAINT "PK_settings_change_epoch" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_settings_change_epoch_one_row" CHECK ("id" = 1)
      )`);
    await queryRunner.query(
      `INSERT INTO "settings_change_epoch" DEFAULT VALUES`
    );
    await queryRunner.query(`
      CREATE TABLE "settings_change_applied" (
        "id" smallint NOT NULL DEFAULT 1,
        "epoch" uuid NOT NULL,
        "version" bigint NOT NULL,
        "applied_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_settings_change_applied" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_settings_change_applied_one_row" CHECK ("id" = 1)
      )`);
    await queryRunner.query(`
      CREATE FUNCTION "settings_change_log_write"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        key_column text := TG_ARGV[0];
        ignored text[] := TG_ARGV[1:];
        changed_keys jsonb;
      BEGIN
        IF TG_OP = 'UPDATE'
          AND (to_jsonb(OLD) - ignored) = (to_jsonb(NEW) - ignored) THEN
          RETURN NULL;
        END IF;

        PERFORM pg_advisory_xact_lock(hashtext('nexus:settings-change-log'));

        IF TG_OP = 'INSERT' THEN
          changed_keys := jsonb_build_array(to_jsonb(NEW) -> key_column);
        ELSIF TG_OP = 'DELETE' THEN
          changed_keys := jsonb_build_array(to_jsonb(OLD) -> key_column);
        ELSIF TG_OP = 'UPDATE' THEN
          changed_keys := (
            SELECT jsonb_agg(DISTINCT k)
            FROM (VALUES (to_jsonb(OLD) -> key_column),
                         (to_jsonb(NEW) -> key_column)) AS v(k)
          );
        END IF;

        INSERT INTO "settings_change_log" ("table_name", "operation", "keys")
        VALUES (TG_TABLE_NAME, TG_OP, changed_keys);

        RETURN NULL;
      END
      $$`);

    for (const { table, args } of LOGGED_TABLES) {
      const quoted = args.map((arg) => `'${arg}'`).join(', ');

      await queryRunner.query(`
        CREATE TRIGGER "TRG_${table}_settings_change_row"
        AFTER INSERT OR UPDATE OR DELETE ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION "settings_change_log_write"(${quoted})`);
      await queryRunner.query(`
        CREATE TRIGGER "TRG_${table}_settings_change_truncate"
        AFTER TRUNCATE ON "${table}"
        FOR EACH STATEMENT EXECUTE FUNCTION "settings_change_log_write"(${quoted})`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { table } of LOGGED_TABLES) {
      await queryRunner.query(
        `DROP TRIGGER "TRG_${table}_settings_change_truncate" ON "${table}"`
      );
      await queryRunner.query(
        `DROP TRIGGER "TRG_${table}_settings_change_row" ON "${table}"`
      );
    }

    await queryRunner.query(`DROP FUNCTION "settings_change_log_write"()`);
    await queryRunner.query(`DROP TABLE "settings_change_applied"`);
    await queryRunner.query(`DROP TABLE "settings_change_epoch"`);
    await queryRunner.query(`DROP TABLE "settings_change_log"`);
    // The orphan rows of deleted roles would refuse the constraint.
    await queryRunner.query(
      `DELETE FROM "user_roles" ur WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."id" = ur."role_id")`
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" ADD CONSTRAINT "FK_user_roles_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }
}
