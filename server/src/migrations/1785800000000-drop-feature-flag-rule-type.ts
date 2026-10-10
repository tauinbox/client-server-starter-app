import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropFeatureFlagRuleType1785800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "feature_flag_rules" DROP COLUMN "type"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "feature_flag_rules" ADD COLUMN "type" varchar(32) NULL
    `);
    await queryRunner.query(`
      UPDATE "feature_flag_rules" SET "type" = "payload"->>'type'
    `);
    await queryRunner.query(`
      ALTER TABLE "feature_flag_rules" ALTER COLUMN "type" SET NOT NULL
    `);
  }
}
