import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTokenRevokedAt1772500000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "token_revoked_at" TIMESTAMP NULL DEFAULT NULL`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "token_revoked_at"`
    );
  }
}
