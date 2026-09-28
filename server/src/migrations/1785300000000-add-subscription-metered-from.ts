import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionMeteredFrom1785300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // A switch of billing mode starts a new metered window inside the period.
    // NULL keeps the whole period as the window, which is what every existing
    // row was rated on.
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN "metered_from" timestamptz NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      DROP COLUMN "metered_from"
    `);
  }
}
