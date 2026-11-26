import { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Empties the member list in the stored payload of each `user` rule. The
 * members are personal data and are already in the regional
 * `feature_flag_rule_users` rows, which the previous build reads too. The key
 * stays as an empty list, because the previous build reads it as an array.
 * The ids cannot come back from the settings side, so `down` changes nothing.
 */
export class EmptyUserRulePayloadIds1795800000000 implements MigrationInterface {
  name = 'EmptyUserRulePayloadIds1795800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "settings"."feature_flag_rules"
       SET "payload" = jsonb_set("payload", '{userIds}', '[]'::jsonb)
       WHERE "payload"->>'type' = 'user' AND "payload"->'userIds' <> '[]'::jsonb`
    );
  }

  public async down(): Promise<void> {}
}
