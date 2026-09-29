import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionPlanChangeLease1785400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // The claim of a plan change in flight, which the renewal scan respects.
    // NULL is the state of every existing row: no change is in flight.
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN "plan_change_started_at" timestamptz NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      DROP COLUMN "plan_change_started_at"
    `);
  }
}
