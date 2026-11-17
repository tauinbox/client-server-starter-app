import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropPlanMeterKey1794891256028 implements MigrationInterface {
  name = 'DropPlanMeterKey1794891256028';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "plans" DROP COLUMN "meter_key"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "plans" ADD "meter_key" character varying(100)`
    );
  }
}
