import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserLocale1779780885589 implements MigrationInterface {
  name = 'AddUserLocale1779780885589';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "locale" character varying NOT NULL DEFAULT 'en'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "locale"`);
  }
}
