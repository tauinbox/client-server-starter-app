import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserTotpColumns1784100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // The secret is ciphertext produced by SecretEncryptionService, not a hash:
    // verifying a code needs the original value back. Its length varies with
    // the payload, so the column is unbounded text rather than a fixed varchar.
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "totp_secret" character varying NULL,
      ADD COLUMN "totp_enabled_at" timestamptz NULL,
      ADD COLUMN "totp_recovery_codes" jsonb NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN "totp_recovery_codes",
      DROP COLUMN "totp_enabled_at",
      DROP COLUMN "totp_secret"
    `);
  }
}
