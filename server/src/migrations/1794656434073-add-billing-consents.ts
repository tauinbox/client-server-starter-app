import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBillingConsents1794656434073 implements MigrationInterface {
  name = 'AddBillingConsents1794656434073';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "billing_consents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "kind" character varying(16) NOT NULL,
        "jurisdiction" character varying(8) NOT NULL,
        "document_version" character varying(32) NOT NULL,
        "accepted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_billing_consents_acceptance" UNIQUE ("user_id", "kind", "jurisdiction", "document_version"),
        CONSTRAINT "PK_billing_consents" PRIMARY KEY ("id")
      )`
    );
    await queryRunner.query(
      `ALTER TABLE "billing_consents" ADD CONSTRAINT "FK_billing_consents_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TYPE "audit_logs_action_enum" ADD VALUE IF NOT EXISTS 'BILLING_TERMS_ACCEPT'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "billing_consents"`);
    // PostgreSQL cannot remove an enum value; BILLING_TERMS_ACCEPT stays.
  }
}
