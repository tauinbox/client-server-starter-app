import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserNotifications1794672723825 implements MigrationInterface {
  name = 'AddUserNotifications1794672723825';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "kind" character varying(48) NOT NULL,
        "payload" jsonb NOT NULL,
        "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(),
        "read_at" TIMESTAMP(3) WITH TIME ZONE,
        CONSTRAINT "PK_user_notifications" PRIMARY KEY ("id")
      )`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_notifications_user_created" ON "user_notifications" ("user_id", "created_at", "id")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_notifications_user_unread" ON "user_notifications" ("user_id") WHERE "read_at" IS NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "user_notifications" ADD CONSTRAINT "FK_user_notifications_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_notifications"`);
  }
}
