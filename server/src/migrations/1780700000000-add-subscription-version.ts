import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionVersion1780700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Optimistic-concurrency token for self-service plan changes: each change
    // claims the row with a compare-and-swap on this value, so two concurrent
    // changes can't both reach the provider charge.
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN "version" integer NOT NULL DEFAULT 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      DROP COLUMN "version"
    `);
  }
}
