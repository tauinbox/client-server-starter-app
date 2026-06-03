import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the billing availability flags:
 *  - public `billing` flag (UI availability) + an attribute rule gating it on
 *    the env-derived `billingConfigured` signal — hidden until a provider is
 *    configured;
 *  - per-provider admin kill-switch flags (`billing.provider.*.enabled`,
 *    consumed by the geo-router), seeded disabled by default.
 *
 * Idempotent so it is safe where the seeder never runs (production). Literals
 * are inlined intentionally — migrations are historical records and must not
 * drift with the shared billing-flags constants.
 */
export class SeedBillingFlags1780000000000 implements MigrationInterface {
  private static readonly providerFlagKeys = [
    'billing.provider.paddle.enabled',
    'billing.provider.yookassa.enabled'
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "feature_flags"
         ("key", "description", "enabled", "environments", "public", "version")
       VALUES ('billing', 'Show billing (gated by at least one provider being configured)', true, '{}', true, 1)
       ON CONFLICT ("key") DO NOTHING`
    );

    await queryRunner.query(
      `INSERT INTO "feature_flag_rules" ("flag_id", "type", "effect", "payload")
       SELECT f."id", 'attribute', 'include', $1::jsonb
       FROM "feature_flags" f
       WHERE f."key" = 'billing'
         AND NOT EXISTS (
           SELECT 1 FROM "feature_flag_rules" r WHERE r."flag_id" = f."id"
         )`,
      [
        JSON.stringify({
          type: 'attribute',
          field: 'custom',
          op: 'eq',
          value: true,
          customKey: 'billingConfigured'
        })
      ]
    );

    await queryRunner.query(
      `INSERT INTO "feature_flags"
         ("key", "description", "enabled", "environments", "public", "version")
       VALUES
         ('billing.provider.paddle.enabled', 'Admin kill-switch enabling the paddle billing provider', false, '{}', false, 1),
         ('billing.provider.yookassa.enabled', 'Admin kill-switch enabling the yookassa billing provider', false, '{}', false, 1)
       ON CONFLICT ("key") DO NOTHING`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // FK feature_flag_rules.flag_id is ON DELETE CASCADE — removing the flags
    // removes their rules.
    await queryRunner.query(
      `DELETE FROM "feature_flags" WHERE "key" = ANY($1)`,
      [['billing', ...SeedBillingFlags1780000000000.providerFlagKeys]]
    );
  }
}
