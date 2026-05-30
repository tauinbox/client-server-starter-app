import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds one public feature flag per OAuth provider plus an attribute rule that
 * gates it on the provider being configured. Idempotent so it is safe on
 * environments where the seeder never runs (production). Literals are inlined
 * intentionally — migrations are historical records and must not drift with the
 * shared `OAUTH_PROVIDER_FLAGS` constant.
 */
export class SeedOauthProviderFlags1779800000000 implements MigrationInterface {
  private static readonly providers = [
    {
      provider: 'google',
      flagKey: 'oauth-google',
      attributeKey: 'oauthGoogleConfigured'
    },
    {
      provider: 'facebook',
      flagKey: 'oauth-facebook',
      attributeKey: 'oauthFacebookConfigured'
    },
    { provider: 'vk', flagKey: 'oauth-vk', attributeKey: 'oauthVkConfigured' }
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const {
      provider,
      flagKey,
      attributeKey
    } of SeedOauthProviderFlags1779800000000.providers) {
      await queryRunner.query(
        `INSERT INTO "feature_flags"
           ("key", "description", "enabled", "environments", "public", "version")
         VALUES ($1, $2, true, '{}', true, 1)
         ON CONFLICT ("key") DO NOTHING`,
        [
          flagKey,
          `Show the ${provider} OAuth login button (gated by provider configuration)`
        ]
      );

      await queryRunner.query(
        `INSERT INTO "feature_flag_rules" ("flag_id", "type", "effect", "payload")
         SELECT f."id", 'attribute', 'include', $2::jsonb
         FROM "feature_flags" f
         WHERE f."key" = $1
           AND NOT EXISTS (
             SELECT 1 FROM "feature_flag_rules" r WHERE r."flag_id" = f."id"
           )`,
        [
          flagKey,
          JSON.stringify({
            type: 'attribute',
            field: 'custom',
            op: 'eq',
            value: true,
            customKey: attributeKey
          })
        ]
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // FK feature_flag_rules.flag_id is ON DELETE CASCADE — removing the flags
    // removes their rules.
    await queryRunner.query(
      `DELETE FROM "feature_flags" WHERE "key" = ANY($1)`,
      [SeedOauthProviderFlags1779800000000.providers.map((p) => p.flagKey)]
    );
  }
}
