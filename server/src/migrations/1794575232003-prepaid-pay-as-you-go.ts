import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrepaidPayAsYouGo1794575232003 implements MigrationInterface {
  name = 'PrepaidPayAsYouGo1794575232003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "billing_usage_records" ALTER COLUMN "subscription_id" DROP NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_credit_ledger" ADD "ref_usage_record_id" uuid`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_credit_ledger" ADD CONSTRAINT "FK_billing_credit_ledger_ref_usage_record_id" FOREIGN KEY ("ref_usage_record_id") REFERENCES "billing_usage_records"("id") ON DELETE SET NULL ON UPDATE NO ACTION`
    );
    // The seeder inserts a missing plan and never updates one, so the row of a
    // seeded database gets the full set here.
    await queryRunner.query(
      `UPDATE "plans" SET "entitlements" = '{reports,api-access,data-export,priority-support}' WHERE "key" = 'usage'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "plans" SET "entitlements" = '{reports,api-access}' WHERE "key" = 'usage'`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_credit_ledger" DROP CONSTRAINT "FK_billing_credit_ledger_ref_usage_record_id"`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_credit_ledger" DROP COLUMN "ref_usage_record_id"`
    );
    // A use paid from credits has no subscription and cannot satisfy NOT NULL.
    await queryRunner.query(
      `DELETE FROM "billing_usage_records" WHERE "subscription_id" IS NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_usage_records" ALTER COLUMN "subscription_id" SET NOT NULL`
    );
  }
}
