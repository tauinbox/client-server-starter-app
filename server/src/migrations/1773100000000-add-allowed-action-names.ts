import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAllowedActionNames1773100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "resources"
      ADD COLUMN "allowed_action_names" text[] DEFAULT NULL
    `);

    await queryRunner.query(`
      UPDATE "resources"
      SET "allowed_action_names" = ARRAY['create', 'read', 'update', 'delete', 'search', 'assign']
      WHERE name = 'roles'
    `);

    await queryRunner.query(`
      UPDATE "resources"
      SET "allowed_action_names" = ARRAY['read', 'update']
      WHERE name = 'profile'
    `);

    await queryRunner.query(`
      UPDATE "actions"
      SET "is_default" = false
      WHERE name = 'assign'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "actions"
      SET "is_default" = true
      WHERE name = 'assign'
    `);

    await queryRunner.query(`
      ALTER TABLE "resources"
      DROP COLUMN "allowed_action_names"
    `);
  }
}
