import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBillingCustomerTrialUsedAt1786100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // When a subscription of the customer first went to trialing; checkout
    // gives no second trial once it is set.
    await queryRunner.query(`
      ALTER TABLE "billing_customers"
      ADD COLUMN "trial_used_at" TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_customers"
      DROP COLUMN "trial_used_at"
    `);
  }
}
