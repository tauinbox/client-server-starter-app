import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropFeatureFlagRulePriority1774000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "feature_flag_rules"
      SET "created_at" = "created_at" + ("priority" * INTERVAL '1 microsecond')
    `);
    await queryRunner.query(`
      ALTER TABLE "feature_flag_rules"
      ALTER COLUMN "created_at" SET DEFAULT clock_timestamp()
    `);
    await queryRunner.query(`
      ALTER TABLE "feature_flag_rules" DROP COLUMN "priority"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "feature_flag_rules"
      ADD COLUMN "priority" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "feature_flag_rules"
      ALTER COLUMN "created_at" SET DEFAULT now()
    `);
  }
}
