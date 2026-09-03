import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshTokenSessionId1784300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // A session outlives the rows that carry it: rotation revokes one row and
    // inserts the next with the same session id, so an access token minted for
    // that session stays valid across a refresh it did not perform itself.
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      ADD COLUMN "session_id" uuid NULL
    `);
    await queryRunner.query(`
      UPDATE "refresh_tokens" SET "session_id" = "id" WHERE "session_id" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens" ALTER COLUMN "session_id" SET NOT NULL
    `);
    // The access-token check runs on every authenticated request and asks only
    // for a live row of one session, so the index carries the same predicate.
    await queryRunner.query(`
      CREATE INDEX "idx_refresh_tokens_session_active"
      ON "refresh_tokens"("session_id") WHERE "revoked" = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_refresh_tokens_session_active"`
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP COLUMN "session_id"`
    );
  }
}
