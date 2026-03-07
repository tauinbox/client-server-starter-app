import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropFeatureTable1772800000000 implements MigrationInterface {
  name = 'DropFeatureTable1772800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "feature"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "feature" ("id" integer GENERATED ALWAYS AS IDENTITY NOT NULL, "name" text NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_03930932f909ca4be8e33d16a2d" PRIMARY KEY ("id"))`
    );
  }
}
