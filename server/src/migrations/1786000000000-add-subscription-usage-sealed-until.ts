import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionUsageSealedUntil1786000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // The end of the last metered window a self-managed close started to rate;
    // usage ingest refuses an occurredAt before it.
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN "usage_sealed_until" TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      DROP COLUMN "usage_sealed_until"
    `);
  }
}
