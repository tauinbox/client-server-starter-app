import { MigrationInterface, QueryRunner } from 'typeorm';

export class RbacTables1772000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create roles table
    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar NOT NULL,
        "description" varchar NULL,
        "is_system" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_roles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_roles_name" UNIQUE ("name")
      )
    `);

    // Create permissions table
    await queryRunner.query(`
      CREATE TABLE "permissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "resource" varchar NOT NULL,
        "action" varchar NOT NULL,
        "description" varchar NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_permissions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_permissions_resource_action" UNIQUE ("resource", "action")
      )
    `);

    // Create role_permissions table
    await queryRunner.query(`
      CREATE TABLE "role_permissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "role_id" uuid NOT NULL,
        "permission_id" uuid NOT NULL,
        "conditions" jsonb NULL,
        CONSTRAINT "PK_role_permissions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_role_permissions_role_permission" UNIQUE ("role_id", "permission_id"),
        CONSTRAINT "FK_role_permissions_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_role_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
      )
    `);

    // Create user_roles join table
    await queryRunner.query(`
      CREATE TABLE "user_roles" (
        "user_id" uuid NOT NULL,
        "role_id" uuid NOT NULL,
        CONSTRAINT "PK_user_roles" PRIMARY KEY ("user_id", "role_id"),
        CONSTRAINT "FK_user_roles_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_roles_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE
      )
    `);

    // Seed system roles
    await queryRunner.query(`
      INSERT INTO "roles" ("name", "description", "is_system") VALUES
        ('admin', 'System administrator with full access', true),
        ('user', 'Regular user with basic access', true)
    `);

    // Seed all permissions
    await queryRunner.query(`
      INSERT INTO "permissions" ("resource", "action", "description") VALUES
        ('users', 'create', 'Create new users'),
        ('users', 'read', 'View user details'),
        ('users', 'update', 'Update user information'),
        ('users', 'delete', 'Delete users'),
        ('users', 'list', 'List all users'),
        ('users', 'search', 'Search users'),
        ('profile', 'read', 'View own profile'),
        ('profile', 'update', 'Update own profile'),
        ('roles', 'create', 'Create new roles'),
        ('roles', 'read', 'View roles'),
        ('roles', 'update', 'Update roles'),
        ('roles', 'delete', 'Delete roles'),
        ('roles', 'assign', 'Assign roles to users')
    `);

    // Assign all permissions to admin role
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      CROSS JOIN "permissions" p
      WHERE r."name" = 'admin'
    `);

    // Assign profile permissions to user role
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id"
      FROM "roles" r
      CROSS JOIN "permissions" p
      WHERE r."name" = 'user' AND p."resource" = 'profile'
    `);

    // Data migration: assign admin role to existing admin users
    await queryRunner.query(`
      INSERT INTO "user_roles" ("user_id", "role_id")
      SELECT u."id", r."id"
      FROM "users" u
      CROSS JOIN "roles" r
      WHERE u."isAdmin" = true AND r."name" = 'admin'
    `);

    // Data migration: assign user role to existing non-admin users
    await queryRunner.query(`
      INSERT INTO "user_roles" ("user_id", "role_id")
      SELECT u."id", r."id"
      FROM "users" u
      CROSS JOIN "roles" r
      WHERE u."isAdmin" = false AND r."name" = 'user'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_roles"`);
    await queryRunner.query(`DROP TABLE "role_permissions"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(`DROP TABLE "roles"`);
  }
}
