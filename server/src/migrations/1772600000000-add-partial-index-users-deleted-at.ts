import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPartialIndexUsersDeletedAt1772600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // DB-1: partial indexes covering only non-deleted users
    // Speeds up email lookups (login path) by skipping deleted rows
    await queryRunner.query(
      `CREATE INDEX "idx_users_email_not_deleted" ON "users"("email") WHERE "deleted_at" IS NULL`
    );

    // Speeds up paginated user list (default sort by created_at) for active users
    await queryRunner.query(
      `CREATE INDEX "idx_users_created_at_not_deleted" ON "users"("created_at" DESC) WHERE "deleted_at" IS NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_users_created_at_not_deleted"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_users_email_not_deleted"`
    );
  }
}
