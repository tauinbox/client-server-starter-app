import { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * The members of a `user` rule are personal data, so they move out of the
 * settings row into a table of the user. The payload keeps its `userIds` for
 * now: a node of the previous build still reads it during a rolling deploy.
 * A member id with no user row is not copied, because it matches nobody.
 */
export class AddFeatureFlagRuleUsers1795525831390 implements MigrationInterface {
  name = 'AddFeatureFlagRuleUsers1795525831390';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "feature_flag_rule_users" (
        "rule_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        CONSTRAINT "PK_feature_flag_rule_users" PRIMARY KEY ("rule_id", "user_id"),
        CONSTRAINT "FK_feature_flag_rule_users_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_feature_flag_rule_users_user_id" ON "feature_flag_rule_users" ("user_id")`
    );
    await queryRunner.query(`
      INSERT INTO "feature_flag_rule_users" ("rule_id", "user_id")
      SELECT DISTINCT r."id", u."id"
      FROM "feature_flag_rules" r
      CROSS JOIN LATERAL jsonb_array_elements_text(r."payload" -> 'userIds') AS m("user_id")
      JOIN "users" u ON u."id"::text = m."user_id"
      WHERE r."payload" ->> 'type' = 'user'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "feature_flag_rule_users"`);
  }
}
