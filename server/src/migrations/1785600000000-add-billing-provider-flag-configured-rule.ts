import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives each billing provider kill-switch the rule that the OAuth provider
 * flags carry: `attribute / custom / eq true` on `<provider>Configured`.
 * Checkout now evaluates these flags in full, so the rule keeps a provider
 * with no credentials off, as the OAuth flags do.
 *
 * A row gets the rule only when it has no rule yet, so a second run changes
 * nothing and a rule set that an admin wrote stays as it is. The version bump
 * makes an open edit dialog fail its If-Match check. Literals are inlined
 * intentionally: migrations are historical records and must not drift with
 * the shared constants.
 */
export class AddBillingProviderFlagConfiguredRule1785600000000 implements MigrationInterface {
  private static readonly flags: ReadonlyArray<readonly [string, string]> = [
    ['billing-paddle', 'paddleConfigured'],
    ['billing-yookassa', 'yookassaConfigured']
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [
      key,
      attribute
    ] of AddBillingProviderFlagConfiguredRule1785600000000.flags) {
      await queryRunner.query(
        `WITH "added" AS (
           INSERT INTO "feature_flag_rules" ("flag_id", "type", "effect", "payload")
           SELECT f."id", 'attribute', 'include', $2::jsonb
             FROM "feature_flags" f
            WHERE f."key" = $1
              AND NOT EXISTS (
                SELECT 1 FROM "feature_flag_rules" r WHERE r."flag_id" = f."id"
              )
           RETURNING "flag_id"
         )
         UPDATE "feature_flags"
            SET "version" = "version" + 1, "updated_at" = now()
          WHERE "id" IN (SELECT "flag_id" FROM "added")`,
        [
          key,
          AddBillingProviderFlagConfiguredRule1785600000000.payload(attribute)
        ]
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [
      key,
      attribute
    ] of AddBillingProviderFlagConfiguredRule1785600000000.flags) {
      await queryRunner.query(
        `WITH "removed" AS (
           DELETE FROM "feature_flag_rules" r
            USING "feature_flags" f
            WHERE r."flag_id" = f."id"
              AND f."key" = $1
              AND r."payload" = $2::jsonb
           RETURNING r."flag_id"
         )
         UPDATE "feature_flags"
            SET "version" = "version" + 1, "updated_at" = now()
          WHERE "id" IN (SELECT "flag_id" FROM "removed")`,
        [
          key,
          AddBillingProviderFlagConfiguredRule1785600000000.payload(attribute)
        ]
      );
    }
  }

  private static payload(attribute: string): string {
    return JSON.stringify({
      type: 'attribute',
      field: 'custom',
      op: 'eq',
      value: true,
      customKey: attribute
    });
  }
}
