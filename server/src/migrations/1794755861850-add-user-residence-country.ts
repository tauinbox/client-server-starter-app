import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserResidenceCountry1794755861850 implements MigrationInterface {
  name = 'AddUserResidenceCountry1794755861850';

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
