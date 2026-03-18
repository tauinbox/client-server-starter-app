import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniqueIndexRolesIsSuper1773200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_roles_is_super"
      ON "roles" ("is_super")
      WHERE "is_super" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_roles_is_super"`);
  }
}
