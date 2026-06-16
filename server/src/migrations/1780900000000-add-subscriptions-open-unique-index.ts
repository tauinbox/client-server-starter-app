import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionsOpenUniqueIndex1780900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // At most one open subscription per customer, enforced in the DB so it holds
    // across instances/races that code-only checks miss. Partial: canceled rows
    // stay unconstrained so history is retained.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_subscriptions_customer_open"
      ON "subscriptions" ("customer_id")
      WHERE "status" IN ('incomplete', 'trialing', 'active', 'past_due')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "UQ_subscriptions_customer_open"
    `);
  }
}
