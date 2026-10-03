import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames the billing provider kill-switch flags to keys that match the
 * feature-flag key rule, so the admin UI can edit them and re-create them.
 *
 * A row is renamed only when no row already holds the new key, so a second run
 * changes nothing. Literals are inlined intentionally: migrations are
 * historical records and must not drift with the shared constants.
 */
export class RenameBillingProviderFlagKeys1785500000000 implements MigrationInterface {
  private static readonly renames: ReadonlyArray<readonly [string, string]> = [
    ['billing.provider.paddle.enabled', 'billing-paddle'],
    ['billing.provider.yookassa.enabled', 'billing-yookassa']
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [
      from,
      to
    ] of RenameBillingProviderFlagKeys1785500000000.renames) {
      await this.rename(queryRunner, from, to);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [
      from,
      to
    ] of RenameBillingProviderFlagKeys1785500000000.renames) {
      await this.rename(queryRunner, to, from);
    }
  }

  // The version bump makes an edit dialog that loaded the old key fail its
  // If-Match check instead of writing over the renamed row.
  private async rename(
    queryRunner: QueryRunner,
    from: string,
    to: string
  ): Promise<void> {
    await queryRunner.query(
      `UPDATE "feature_flags"
          SET "key" = $2, "version" = "version" + 1, "updated_at" = now()
        WHERE "key" = $1
          AND NOT EXISTS (SELECT 1 FROM "feature_flags" WHERE "key" = $2)`,
      [from, to]
    );
  }
}
