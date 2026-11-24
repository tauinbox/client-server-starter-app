import { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * The audit row of a settings write is committed before the write, because
 * after the split the row is in the regional database and the write in the
 * settings database. `settings_outcome` is `pending` until the write commits
 * or fails; a row of a node of the previous build, and of any other write, has
 * none. Each change log entry keeps the id of the audit row of its write, which
 * the write sets with `set_config('nexus.audit_id', ...)`, so a row that a
 * stopped node left `pending` is settled from the log.
 *
 * The invoice keeps the product id with no foreign key: the product is a
 * settings row.
 */
const LOG_WRITE_FUNCTION = (withAuditId: boolean) => `
  CREATE OR REPLACE FUNCTION "settings_change_log_write"() RETURNS trigger
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

    ${
      withAuditId
        ? `INSERT INTO "settings_change_log" ("table_name", "operation", "keys", "audit_id")
    VALUES (TG_TABLE_NAME, TG_OP, changed_keys,
            NULLIF(current_setting('nexus.audit_id', true), '')::uuid);`
        : `INSERT INTO "settings_change_log" ("table_name", "operation", "keys")
    VALUES (TG_TABLE_NAME, TG_OP, changed_keys);`
    }

    RETURN NULL;
  END
  $$`;

export class AddSettingsAuditOutcome1795533760005 implements MigrationInterface {
  name = 'AddSettingsAuditOutcome1795533760005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing_invoices" DROP CONSTRAINT "FK_billing_invoices_product_id"`
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD "settings_outcome" character varying(16)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_settings_pending" ON "audit_logs" ("created_at") WHERE "settings_outcome" = 'pending'`
    );
    await queryRunner.query(
      `ALTER TABLE "settings_change_log" ADD "audit_id" uuid`
    );
    await queryRunner.query(LOG_WRITE_FUNCTION(true));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(LOG_WRITE_FUNCTION(false));
    await queryRunner.query(
      `ALTER TABLE "settings_change_log" DROP COLUMN "audit_id"`
    );
    await queryRunner.query(`DROP INDEX "IDX_audit_logs_settings_pending"`);
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP COLUMN "settings_outcome"`
    );
    // An invoice whose product row is gone would refuse the constraint.
    await queryRunner.query(
      `UPDATE "billing_invoices" i SET "product_id" = NULL WHERE "product_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "billing_products" p WHERE p."id" = i."product_id")`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_invoices" ADD CONSTRAINT "FK_billing_invoices_product_id" FOREIGN KEY ("product_id") REFERENCES "billing_products"("id") ON DELETE SET NULL ON UPDATE NO ACTION`
    );
  }
}
