import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionBillingAnchor1783700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Boundaries were chained onto their own previous output, so one February
    // clamp moved a month-end customer to the 28th permanently. They are now
    // restored to the day recorded here.
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      ADD COLUMN "billing_anchor_at" timestamptz NULL
    `);

    // The current period start is the only anchor the data still holds, so rows
    // that already drifted keep their drifted day. Provider-managed rows stay
    // NULL - their boundaries come from the provider's snapshot.
    await queryRunner.query(`
      UPDATE "subscriptions"
         SET "billing_anchor_at" = "current_period_start"
       WHERE "lifecycle_owner" = 'self'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
      DROP COLUMN "billing_anchor_at"
    `);
  }
}
