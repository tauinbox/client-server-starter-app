import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordHashVersion1785100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Every stored hash is bcrypt over the raw password, which is version 1.
    // A row moves to version 2 when its owner next signs in or sets a password.
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "password_hash_version" smallint NOT NULL DEFAULT 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // A version 2 hash cannot be verified without this column. Reverting
    // would lock out every account that moved to it.
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN "password_hash_version"
    `);
  }
}
