import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropWebhookPayloadHash1783600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // A digest of the raw delivery body with nothing to compare it against: the
    // raw body is never stored, and the `payload` column already keeps the
    // authoritative NormalizedEvent for both providers.
    await queryRunner.query(`
      ALTER TABLE "billing_webhook_events" DROP COLUMN "payload_hash"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restores the column shape only: the digests themselves are unrecoverable,
    // so existing rows come back with an empty hash.
    await queryRunner.query(`
      ALTER TABLE "billing_webhook_events"
      ADD COLUMN "payload_hash" varchar(255) NOT NULL DEFAULT ''
    `);
    await queryRunner.query(`
      ALTER TABLE "billing_webhook_events"
      ALTER COLUMN "payload_hash" DROP DEFAULT
    `);
  }
}
