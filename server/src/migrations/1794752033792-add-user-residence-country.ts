import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserResidenceCountry1794752033792 implements MigrationInterface {
  name = 'AddUserResidenceCountry1794752033792';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "residence_country" character varying(2)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "residence_country"`
    );
  }
}
