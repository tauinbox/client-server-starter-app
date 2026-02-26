import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuditLogs1772200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "audit_logs_action_enum" AS ENUM (
        'USER_LOGIN_SUCCESS',
        'USER_LOGIN_FAILURE',
        'USER_REGISTER',
        'USER_CREATE',
        'USER_UPDATE',
        'USER_DELETE',
        'PASSWORD_CHANGE',
        'PASSWORD_RESET_REQUEST',
        'PASSWORD_RESET_COMPLETE',
        'OAUTH_LINK',
        'OAUTH_UNLINK',
        'ROLE_CREATE',
        'ROLE_UPDATE',
        'ROLE_DELETE',
        'ROLE_ASSIGN',
        'ROLE_UNASSIGN',
        'PERMISSION_ASSIGN',
        'PERMISSION_UNASSIGN',
        'USER_LOGOUT',
        'TOKEN_REFRESH_FAILURE'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "action" "audit_logs_action_enum" NOT NULL,
        "actor_id" uuid,
        "actor_email" varchar,
        "target_id" varchar,
        "target_type" varchar,
        "details" jsonb,
        "ip_address" varchar,
        "request_id" varchar,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_actor_id" ON "audit_logs" ("actor_id")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_action" ON "audit_logs" ("action")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_created_at" ON "audit_logs" ("created_at")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_audit_logs_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_logs_action"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_logs_actor_id"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TYPE "audit_logs_action_enum"`);
  }
}
