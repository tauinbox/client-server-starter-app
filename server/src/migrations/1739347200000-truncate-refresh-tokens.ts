import { MigrationInterface, QueryRunner } from 'typeorm';

export class TruncateRefreshTokens1739347200000 implements MigrationInterface {
  name = 'TruncateRefreshTokens1739347200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Clear all existing plaintext refresh tokens.
    // After this migration, tokens are stored as SHA-256 hashes.
    // All active sessions will be invalidated — users must log in again.
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'refresh_tokens'
        ) THEN
          TRUNCATE TABLE "refresh_tokens";
        END IF;
      END $$
    `);
  }

  public async down(): Promise<void> {
    // No rollback — cannot restore deleted tokens
  }
}
