import { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Removes the member list key from the stored payload of each `user` rule.
 * The members are in the regional `feature_flag_rule_users` rows, and the
 * build before this one reads a payload with no key. `down` puts back the
 * empty list, which is the form before this migration.
 */
export class DropUserRulePayloadIdsKey1795900000000 implements MigrationInterface {
  name = 'DropUserRulePayloadIdsKey1795900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "settings"."feature_flag_rules"
       SET "payload" = "payload" - 'userIds'
       WHERE "payload"->>'type' = 'user' AND "payload" ? 'userIds'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "settings"."feature_flag_rules"
       SET "payload" = jsonb_set("payload", '{userIds}', '[]'::jsonb)
       WHERE "payload"->>'type' = 'user' AND NOT "payload" ? 'userIds'`
    );
  }
}
