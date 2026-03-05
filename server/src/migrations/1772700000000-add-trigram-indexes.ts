import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTrigramIndexes1772700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    await queryRunner.query(
      `CREATE INDEX "idx_users_email_trgm" ON "users" USING GIN ("email" gin_trgm_ops)`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_users_first_name_trgm" ON "users" USING GIN ("first_name" gin_trgm_ops)`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_users_last_name_trgm" ON "users" USING GIN ("last_name" gin_trgm_ops)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_last_name_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_first_name_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_email_trgm"`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS pg_trgm`);
  }
}
