import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshTokenSessionStartedAt1784700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // A derived anchor does not survive: the cleanup job deletes every revoked
    // ancestor past its own expiry, so MIN(created_at) of a long session is
    // gone before the cap would read it.
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      ADD COLUMN "session_started_at" TIMESTAMP WITH TIME ZONE NULL
    `);
    // Cleanup bounds how far back this reaches, so an existing session starts
    // the cap with at most the age of its oldest surviving ancestor.
    await queryRunner.query(`
      UPDATE "refresh_tokens" AS "rt"
      SET "session_started_at" = "s"."started_at"
      FROM (
        SELECT "session_id", MIN("created_at") AS "started_at"
        FROM "refresh_tokens"
        GROUP BY "session_id"
      ) AS "s"
      WHERE "rt"."session_id" = "s"."session_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      ALTER COLUMN "session_started_at" SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP COLUMN "session_started_at"`
    );
  }
}
