import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Activates the pay-as-you-go plan that shipped seeded inactive: the usage
 * subsystem (rating + current-period view) is now live, so the tier may be
 * exposed in the catalog. Scoped by key AND billing_mode so a renamed or
 * repurposed key is never flipped by accident; idempotent where the plan was
 * already activated by hand or the seeder.
 */
export class ActivateUsagePlan1780300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "plans" SET "active" = true, "updated_at" = now()
       WHERE "key" = 'usage' AND "billing_mode" = 'usage'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "plans" SET "active" = false, "updated_at" = now()
       WHERE "key" = 'usage' AND "billing_mode" = 'usage'`
    );
  }
}
