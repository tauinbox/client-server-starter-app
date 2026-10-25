import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReplaceUserNamesWithName1792926122902 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // A grant condition on a dropped column would turn into a deny-all rule
    // with no warning, so such a grant stops the migration. Rewrite it to the
    // `name` field first.
    await queryRunner.query(`
      DO $$
      DECLARE affected text;
      BEGIN
        SELECT string_agg("id"::text, ', ')
          INTO affected
          FROM "role_permissions"
         WHERE "conditions"::text ~ '(firstName|lastName)';
        IF affected IS NOT NULL THEN
          RAISE EXCEPTION
            'Cannot replace users.firstName and users.lastName: role_permissions rows % have conditions on them. Rewrite the conditions to the name field before migrating.',
            affected;
        END IF;
      END
      $$
    `);

    await queryRunner.query(
      `ALTER TABLE "users" ADD "name" character varying NULL`
    );
    await queryRunner.query(`
      UPDATE "users"
         SET "name" = COALESCE(
           NULLIF(
             concat_ws(' ', NULLIF(btrim("firstName"), ''), NULLIF(btrim("lastName"), '')),
             ''
           ),
           split_part("email", '@', 1)
         )
    `);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "name" SET NOT NULL`
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_first_name_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_last_name_trgm"`);
    await queryRunner.query(
      `CREATE INDEX "idx_users_name_trgm" ON "users" USING GIN ("name" gin_trgm_ops)`
    );

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "firstName"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "lastName"`);
  }

  // Lossy: the original split is gone, so the name is split on its first
  // space. A one-word name gives an empty last name.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "firstName" character varying NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "lastName" character varying NULL`
    );
    await queryRunner.query(`
      UPDATE "users"
         SET "firstName" = split_part("name", ' ', 1),
             "lastName" = CASE
               WHEN position(' ' IN "name") > 0
                 THEN substr("name", position(' ' IN "name") + 1)
               ELSE ''
             END
    `);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "firstName" SET NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "lastName" SET NOT NULL`
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_name_trgm"`);
    await queryRunner.query(
      `CREATE INDEX "idx_users_first_name_trgm" ON "users" USING GIN ("firstName" gin_trgm_ops)`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_users_last_name_trgm" ON "users" USING GIN ("lastName" gin_trgm_ops)`
    );

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "name"`);
  }
}
