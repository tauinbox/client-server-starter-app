import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebhookEventAttempts1781000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Track how many reconciliation-sweep replays a delivery has failed so a
    // genuinely poison event can be quarantined (`status = 'dead_letter'`)
    // instead of being replayed and logged every tick forever. `status` is a
    // plain varchar(16), so the new `dead_letter` value needs no enum change.
    await queryRunner.query(`
      ALTER TABLE "billing_webhook_events"
      ADD COLUMN "attempts" integer NOT NULL DEFAULT 0,
      ADD COLUMN "last_error" text NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "billing_webhook_events"
      DROP COLUMN "last_error",
      DROP COLUMN "attempts"
    `);
  }
}
