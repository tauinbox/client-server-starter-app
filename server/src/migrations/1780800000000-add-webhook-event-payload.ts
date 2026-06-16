import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebhookEventPayload1780800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Persist the verified, provider-agnostic event so the reconciliation sweep
    // can replay a delivery stuck in `received` without the provider. Nullable:
    // rows written before this column predate replay and stay non-replayable.
    await queryRunner.query(`
      ALTER TABLE "billing_webhook_events"
      ADD COLUMN "payload" jsonb NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_webhook_events" DROP COLUMN "payload"
    `);
  }
}
