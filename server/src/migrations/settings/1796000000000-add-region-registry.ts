import { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * The public status of each region. A region with no row is not public, so
 * the table starts empty; the home region is public in the code. The two
 * triggers write the settings change log, as on every settings table.
 */
export class AddRegionRegistry1796000000000 implements MigrationInterface {
  name = 'AddRegionRegistry1796000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "settings"."region_registry" ("region" character varying(32) NOT NULL, "public" boolean NOT NULL, "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_region_registry" PRIMARY KEY ("region"))`
    );
    await queryRunner.query(
      `CREATE TRIGGER "TRG_region_registry_settings_change_row" AFTER INSERT OR UPDATE OR DELETE ON "settings"."region_registry" FOR EACH ROW EXECUTE FUNCTION "settings"."settings_change_log_write"('region', 'updated_at')`
    );
    await queryRunner.query(
      `CREATE TRIGGER "TRG_region_registry_settings_change_truncate" AFTER TRUNCATE ON "settings"."region_registry" FOR EACH STATEMENT EXECUTE FUNCTION "settings"."settings_change_log_write"('region', 'updated_at')`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "settings"."region_registry"`);
  }
}
