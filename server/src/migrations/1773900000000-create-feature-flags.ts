import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFeatureFlags1773900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "feature_flags" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "key" varchar(100) NOT NULL,
        "description" varchar(500) NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "environments" text[] NOT NULL DEFAULT '{}',
        "public" boolean NOT NULL DEFAULT false,
        "version" integer NOT NULL DEFAULT 1,
        "updated_by_user_id" uuid NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_feature_flags" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_feature_flags_key" UNIQUE ("key")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_feature_flags_environments"
      ON "feature_flags" USING gin ("environments")
    `);

    await queryRunner.query(`
      CREATE TABLE "feature_flag_rules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "flag_id" uuid NOT NULL,
        "priority" integer NOT NULL DEFAULT 0,
        "type" varchar(32) NOT NULL,
        "effect" varchar(16) NOT NULL,
        "payload" jsonb NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_feature_flag_rules" PRIMARY KEY ("id"),
        CONSTRAINT "FK_feature_flag_rules_flag_id" FOREIGN KEY ("flag_id")
          REFERENCES "feature_flags"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_feature_flag_rules_flag_id"
      ON "feature_flag_rules" ("flag_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_feature_flag_rules_flag_id"`);
    await queryRunner.query(`DROP TABLE "feature_flag_rules"`);
    await queryRunner.query(`DROP INDEX "IDX_feature_flags_environments"`);
    await queryRunner.query(`DROP TABLE "feature_flags"`);
  }
}
