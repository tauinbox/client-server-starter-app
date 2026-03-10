import { MigrationInterface, QueryRunner } from 'typeorm';

export class DynamicRbac1772900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create resources table
    await queryRunner.query(`
      CREATE TABLE "resources" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar NOT NULL,
        "subject" varchar NOT NULL,
        "display_name" varchar NOT NULL,
        "description" varchar NULL,
        "is_system" boolean NOT NULL DEFAULT false,
        "last_synced_at" TIMESTAMP NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_resources" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_resources_name" UNIQUE ("name")
      )
    `);

    // 2. Create actions table
    await queryRunner.query(`
      CREATE TABLE "actions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar NOT NULL,
        "display_name" varchar NOT NULL,
        "description" varchar NOT NULL DEFAULT '',
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_actions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_actions_name" UNIQUE ("name")
      )
    `);

    // 3. Seed default resources
    await queryRunner.query(`
      INSERT INTO "resources" ("name", "subject", "display_name", "description", "is_system", "last_synced_at") VALUES
        ('users', 'User', 'Users', 'User accounts management', true, now()),
        ('roles', 'Role', 'Roles', 'Role management', true, now()),
        ('permissions', 'Permission', 'Permissions', 'Permission and RBAC metadata management', true, now()),
        ('profile', 'Profile', 'Profile', 'User own profile', true, now())
    `);

    // 4. Seed default actions
    await queryRunner.query(`
      INSERT INTO "actions" ("name", "display_name", "description", "is_default") VALUES
        ('create', 'Create', 'Create a new record', true),
        ('read', 'Read', 'Read a single record by ID', true),
        ('update', 'Update', 'Modify an existing record', true),
        ('delete', 'Delete', 'Remove a record', true),
        ('search', 'Search', 'Query and list records, with optional filters', true),
        ('assign', 'Assign', 'Assign relationships between records', true)
    `);

    // 5. Add resource_id and action_id columns to permissions (nullable initially)
    await queryRunner.query(
      `ALTER TABLE "permissions" ADD "resource_id" uuid NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "permissions" ADD "action_id" uuid NULL`
    );

    // 6. Populate FK columns from existing string data
    await queryRunner.query(`
      UPDATE "permissions" p
      SET "resource_id" = r."id"
      FROM "resources" r
      WHERE r."name" = p."resource"
    `);

    await queryRunner.query(`
      UPDATE "permissions" p
      SET "action_id" = a."id"
      FROM "actions" a
      WHERE a."name" = p."action"
    `);

    // 7. Remove the 'list' permission (merged into 'search')
    // First remove from role_permissions, then from permissions
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions" WHERE "action" = 'list'
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "action" = 'list'
    `);

    // 8. Create permissions for new resource×action combos that don't exist yet
    // (e.g. permissions:create, permissions:read, etc. and profile:create, etc.)
    await queryRunner.query(`
      INSERT INTO "permissions" ("resource", "action", "resource_id", "action_id")
      SELECT r."name", a."name", r."id", a."id"
      FROM "resources" r
      CROSS JOIN "actions" a
      WHERE NOT EXISTS (
        SELECT 1 FROM "permissions" p
        WHERE p."resource_id" = r."id" AND p."action_id" = a."id"
      )
    `);

    // 9. Make FK columns NOT NULL
    await queryRunner.query(
      `ALTER TABLE "permissions" ALTER COLUMN "resource_id" SET NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "permissions" ALTER COLUMN "action_id" SET NOT NULL`
    );

    // 10. Drop old unique constraint and string columns
    await queryRunner.query(
      `ALTER TABLE "permissions" DROP CONSTRAINT "UQ_permissions_resource_action"`
    );
    await queryRunner.query(`ALTER TABLE "permissions" DROP COLUMN "resource"`);
    await queryRunner.query(`ALTER TABLE "permissions" DROP COLUMN "action"`);

    // 11. Add FK constraints with ON DELETE RESTRICT
    await queryRunner.query(`
      ALTER TABLE "permissions"
      ADD CONSTRAINT "FK_permissions_resource"
      FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "permissions"
      ADD CONSTRAINT "FK_permissions_action"
      FOREIGN KEY ("action_id") REFERENCES "actions"("id") ON DELETE RESTRICT
    `);

    // 12. Add unique constraint on (resource_id, action_id)
    await queryRunner.query(`
      ALTER TABLE "permissions"
      ADD CONSTRAINT "UQ_permissions_resource_action" UNIQUE ("resource_id", "action_id")
    `);

    // 13. Add is_super column to roles
    await queryRunner.query(
      `ALTER TABLE "roles" ADD "is_super" boolean NOT NULL DEFAULT false`
    );

    // 14. Set admin role as super
    await queryRunner.query(`
      UPDATE "roles" SET "is_super" = true WHERE "name" = 'admin'
    `);

    // 15. Assign all new permissions to admin role
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      CROSS JOIN "permissions" p
      WHERE r."name" = 'admin'
        AND NOT EXISTS (
          SELECT 1 FROM "role_permissions" rp
          WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse: restore string columns, drop FK, drop new tables

    // Remove is_super from roles
    await queryRunner.query(`ALTER TABLE "roles" DROP COLUMN "is_super"`);

    // Drop FK constraints
    await queryRunner.query(
      `ALTER TABLE "permissions" DROP CONSTRAINT "UQ_permissions_resource_action"`
    );
    await queryRunner.query(
      `ALTER TABLE "permissions" DROP CONSTRAINT "FK_permissions_action"`
    );
    await queryRunner.query(
      `ALTER TABLE "permissions" DROP CONSTRAINT "FK_permissions_resource"`
    );

    // Re-add string columns
    await queryRunner.query(
      `ALTER TABLE "permissions" ADD "resource" varchar NOT NULL DEFAULT ''`
    );
    await queryRunner.query(
      `ALTER TABLE "permissions" ADD "action" varchar NOT NULL DEFAULT ''`
    );

    // Populate string columns from FK data
    await queryRunner.query(`
      UPDATE "permissions" p
      SET "resource" = r."name"
      FROM "resources" r
      WHERE r."id" = p."resource_id"
    `);
    await queryRunner.query(`
      UPDATE "permissions" p
      SET "action" = a."name"
      FROM "actions" a
      WHERE a."id" = p."action_id"
    `);

    // Drop FK columns
    await queryRunner.query(
      `ALTER TABLE "permissions" DROP COLUMN "resource_id"`
    );
    await queryRunner.query(
      `ALTER TABLE "permissions" DROP COLUMN "action_id"`
    );

    // Re-add old unique constraint
    await queryRunner.query(`
      ALTER TABLE "permissions"
      ADD CONSTRAINT "UQ_permissions_resource_action" UNIQUE ("resource", "action")
    `);

    // Remove permissions that didn't exist before (keep only original 13)
    await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "permission_id" IN (
        SELECT "id" FROM "permissions"
        WHERE ("resource", "action") NOT IN (
          ('users', 'create'), ('users', 'read'), ('users', 'update'),
          ('users', 'delete'), ('users', 'list'), ('users', 'search'),
          ('profile', 'read'), ('profile', 'update'),
          ('roles', 'create'), ('roles', 'read'), ('roles', 'update'),
          ('roles', 'delete'), ('roles', 'assign')
        )
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE ("resource", "action") NOT IN (
        ('users', 'create'), ('users', 'read'), ('users', 'update'),
        ('users', 'delete'), ('users', 'list'), ('users', 'search'),
        ('profile', 'read'), ('profile', 'update'),
        ('roles', 'create'), ('roles', 'read'), ('roles', 'update'),
        ('roles', 'delete'), ('roles', 'assign')
      )
    `);

    // Drop new tables
    await queryRunner.query(`DROP TABLE "actions"`);
    await queryRunner.query(`DROP TABLE "resources"`);
  }
}
