import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIndexes1772100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // S11: refresh_tokens lookups
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_token" ON "refresh_tokens"("token")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens"("user_id")`
    );

    // S13: partial index for active token pruning
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_user_active" ON "refresh_tokens"("user_id", "created_at" DESC) WHERE "revoked" = false`
    );

    // S12: RBAC join table FK indexes
    await queryRunner.query(
      `CREATE INDEX "idx_user_roles_role_id" ON "user_roles"("role_id")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_role_permissions_role_id" ON "role_permissions"("role_id")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_role_permissions_permission_id" ON "role_permissions"("permission_id")`
    );

    // S14: token lookups on users table (partial indexes — only non-null values)
    await queryRunner.query(
      `CREATE INDEX "idx_users_email_verification_token" ON "users"("email_verification_token") WHERE "email_verification_token" IS NOT NULL`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_users_password_reset_token" ON "users"("password_reset_token") WHERE "password_reset_token" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_users_password_reset_token"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_users_email_verification_token"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_role_permissions_permission_id"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_role_permissions_role_id"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_user_roles_role_id"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_refresh_tokens_user_active"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_refresh_tokens_user_id"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_refresh_tokens_token"`);
  }
}
