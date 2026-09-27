import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshTokenIpLocation1785200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // No backfill: nothing recorded the address of an existing session. The
    // next rotation of such a session writes it.
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      ADD COLUMN "ip_address" character varying(45) NULL,
      ADD COLUMN "country_code" character varying(2) NULL,
      ADD COLUMN "city" character varying(128) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
      DROP COLUMN "city",
      DROP COLUMN "country_code",
      DROP COLUMN "ip_address"
    `);
  }
}
