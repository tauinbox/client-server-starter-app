import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshTokenUserAgent1784800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // No backfill: nothing recorded the device of an existing session, and the
    // list shows such a session as an unknown device.
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      ADD COLUMN "user_agent" character varying(512) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP COLUMN "user_agent"`
    );
  }
}
