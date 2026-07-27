import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsersEmailLowerUnique1783400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Collapsing two live accounts means choosing whose data survives, so a
    // pre-existing case-variant collision aborts rather than being deduped
    // automatically (same stance as UQ_resources_subject).
    await queryRunner.query(`
      DO $$
      DECLARE collisions text;
      BEGIN
        SELECT string_agg(lowered, ', ')
          INTO collisions
          FROM (
            SELECT lower(email) AS lowered
              FROM "users"
             GROUP BY lower(email)
            HAVING count(*) > 1
          ) d;
        IF collisions IS NOT NULL THEN
          RAISE EXCEPTION
            'Cannot add UQ_users_email_lower: case-variant duplicate accounts present (%). Merge them before migrating.',
            collisions;
        END IF;
      END $$
    `);

    // Soft-deleted rows are included, matching the plain UNIQUE on "email":
    // a deleted account still reserves its address until it is hard-deleted.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_users_email_lower" ON "users" (lower(email))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_users_email_lower"`);
  }
}
