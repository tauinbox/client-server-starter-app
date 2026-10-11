import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionPlanChangeSeq1785900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // The count of committed self-service plan changes; the idempotence keys
    // of the money legs of a switch include it.
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN "plan_change_seq" integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      DROP COLUMN "plan_change_seq"
    `);
  }
}
