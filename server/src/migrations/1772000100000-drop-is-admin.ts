import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropIsAdmin1772000100000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "is_admin"`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "is_admin" boolean NOT NULL DEFAULT false`
    );
  }
}
