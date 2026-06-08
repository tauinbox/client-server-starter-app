import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionDunning1780100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN "dunning_attempts" integer NOT NULL DEFAULT 0,
      ADD COLUMN "next_renewal_attempt_at" TIMESTAMP NULL
    `);

    // The self-managed renewal scheduler scans by due time per status; an index
    // on the retry marker keeps the past_due dunning sweep cheap as it grows.
    await queryRunner.query(`
      CREATE INDEX "IDX_subscriptions_next_renewal_attempt_at"
      ON "subscriptions" ("next_renewal_attempt_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "IDX_subscriptions_next_renewal_attempt_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      DROP COLUMN "next_renewal_attempt_at",
      DROP COLUMN "dunning_attempts"
    `);
  }
}
