import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOauthAccountsUserProviderUnique1792775795164 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // The API addresses a linked provider by name, so an account keeps one
    // identity per provider: the oldest link stays, the newer ones go.
    await queryRunner.query(`
      DELETE FROM "oauth_accounts" a
      USING "oauth_accounts" b
      WHERE a."user_id" = b."user_id"
        AND a."provider" = b."provider"
        AND (a."created_at", a."id") > (b."created_at", b."id")
    `);
    await queryRunner.query(`
      ALTER TABLE "oauth_accounts"
      ADD CONSTRAINT "UQ_43effea36b32036537a94ab76f3" UNIQUE ("user_id", "provider")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "oauth_accounts"
      DROP CONSTRAINT "UQ_43effea36b32036537a94ab76f3"
    `);
  }
}
