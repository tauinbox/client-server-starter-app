import { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * The settings tables and their rows as the frozen history of one database
 * left them (the 92 migrations up to AddSettingsAuditOutcome1795533760005),
 * taken from `pg_dump` of a database that the whole history migrated.
 * `server/test/migration-baseline.e2e-spec.ts` compares the schema and the
 * rows that this migration and the regional baseline build with those of that
 * history.
 *
 * The rows go in before the triggers, as in the history, where the settings
 * change log came after them: a new database starts with an empty log.
 */

// The body is the text of the history, byte for byte: the catalog keeps it.
const CHANGE_LOG_FUNCTION = `CREATE FUNCTION "settings_change_log_write"() RETURNS trigger
LANGUAGE plpgsql AS $$
  DECLARE
    key_column text := TG_ARGV[0];
    ignored text[] := TG_ARGV[1:];
    changed_keys jsonb;
  BEGIN
    IF TG_OP = 'UPDATE'
      AND (to_jsonb(OLD) - ignored) = (to_jsonb(NEW) - ignored) THEN
      RETURN NULL;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('nexus:settings-change-log'));

    IF TG_OP = 'INSERT' THEN
      changed_keys := jsonb_build_array(to_jsonb(NEW) -> key_column);
    ELSIF TG_OP = 'DELETE' THEN
      changed_keys := jsonb_build_array(to_jsonb(OLD) -> key_column);
    ELSIF TG_OP = 'UPDATE' THEN
      changed_keys := (
        SELECT jsonb_agg(DISTINCT k)
        FROM (VALUES (to_jsonb(OLD) -> key_column),
                     (to_jsonb(NEW) -> key_column)) AS v(k)
      );
    END IF;

    INSERT INTO "settings_change_log" ("table_name", "operation", "keys", "audit_id")
    VALUES (TG_TABLE_NAME, TG_OP, changed_keys,
            NULLIF(current_setting('nexus.audit_id', true), '')::uuid);

    RETURN NULL;
  END
  $$`;

const SCHEMA: readonly string[] = [
  `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,
  CHANGE_LOG_FUNCTION,
  `CREATE TABLE "actions" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "name" varchar NOT NULL,
    "created_at" timestamptz(3) NOT NULL DEFAULT now(),
    CONSTRAINT "PK_actions" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_actions_name" UNIQUE ("name")
  )`,
  `CREATE TABLE "resources" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "name" varchar NOT NULL,
    "subject" varchar NOT NULL,
    "display_name" varchar NOT NULL,
    "description" varchar,
    "is_system" boolean NOT NULL DEFAULT false,
    "last_synced_at" timestamptz,
    "created_at" timestamptz(3) NOT NULL DEFAULT now(),
    "allowed_action_names" text[],
    "is_orphaned" boolean NOT NULL DEFAULT false,
    "action_names" text[] NOT NULL DEFAULT '{}',
    "conditional_action_names" text[] NOT NULL DEFAULT '{}',
    CONSTRAINT "PK_resources" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_resources_name" UNIQUE ("name"),
    CONSTRAINT "UQ_resources_subject" UNIQUE ("subject")
  )`,
  `CREATE TABLE "permissions" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "description" varchar,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "resource_id" uuid NOT NULL,
    "action_id" uuid NOT NULL,
    CONSTRAINT "PK_permissions" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_permissions_resource_action" UNIQUE ("resource_id", "action_id")
  )`,
  `CREATE TABLE "roles" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "name" varchar NOT NULL,
    "description" varchar,
    "is_system" boolean NOT NULL DEFAULT false,
    "created_at" timestamptz(3) NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    "is_super" boolean NOT NULL DEFAULT false,
    CONSTRAINT "PK_roles" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_roles_name" UNIQUE ("name")
  )`,
  `CREATE TABLE "role_permissions" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "role_id" uuid NOT NULL,
    "permission_id" uuid NOT NULL,
    "conditions" jsonb,
    CONSTRAINT "PK_role_permissions" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_role_permissions_role_permission" UNIQUE ("role_id", "permission_id")
  )`,
  `CREATE TABLE "feature_flags" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "key" varchar(100) NOT NULL,
    "description" varchar(500),
    "enabled" boolean NOT NULL DEFAULT false,
    "environments" text[] NOT NULL DEFAULT '{}',
    "public" boolean NOT NULL DEFAULT false,
    "version" integer NOT NULL DEFAULT 1,
    "updated_by_user_id" uuid,
    "created_at" timestamptz(3) NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "PK_feature_flags" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_feature_flags_key" UNIQUE ("key")
  )`,
  `CREATE TABLE "feature_flag_rules" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "flag_id" uuid NOT NULL,
    "effect" varchar(16) NOT NULL,
    "payload" jsonb NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT clock_timestamp(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "PK_feature_flag_rules" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE "plans" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "key" varchar(100) NOT NULL,
    "name" varchar(100) NOT NULL,
    "description" varchar(500),
    "billing_mode" varchar(16) NOT NULL,
    "interval" varchar(16) NOT NULL,
    "entitlements" text[] NOT NULL DEFAULT '{}',
    "limits" jsonb,
    "trial_days" integer NOT NULL DEFAULT 0,
    "active" boolean NOT NULL DEFAULT true,
    "prices" jsonb NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "PK_plans" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_plans_key" UNIQUE ("key")
  )`,
  `CREATE TABLE "billing_products" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "key" varchar(100) NOT NULL,
    "name" varchar(100) NOT NULL,
    "description" varchar(500),
    "type" varchar(16) NOT NULL,
    "prices" jsonb NOT NULL,
    "grant" jsonb,
    "active" boolean NOT NULL DEFAULT true,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "PK_billing_products" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_billing_products_key" UNIQUE ("key")
  )`,
  `CREATE TABLE "settings_change_log" (
    "version" bigserial NOT NULL,
    "table_name" text NOT NULL,
    "operation" text NOT NULL,
    "keys" jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "audit_id" uuid,
    CONSTRAINT "PK_settings_change_log" PRIMARY KEY ("version")
  )`,
  `CREATE TABLE "settings_change_epoch" (
    "id" smallint NOT NULL DEFAULT 1,
    "epoch" uuid NOT NULL DEFAULT gen_random_uuid(),
    CONSTRAINT "PK_settings_change_epoch" PRIMARY KEY ("id"),
    CONSTRAINT "CHK_settings_change_epoch_one_row" CHECK ("id" = 1)
  )`,
  `CREATE INDEX "IDX_feature_flag_rules_flag_id" ON "feature_flag_rules" ("flag_id")`,
  `CREATE INDEX "IDX_feature_flags_environments" ON "feature_flags" USING gin ("environments")`,
  `CREATE INDEX "IDX_plans_entitlements" ON "plans" USING gin ("entitlements")`,
  `CREATE UNIQUE INDEX "UQ_roles_is_super" ON "roles" ("is_super") WHERE "is_super" = true`,
  `CREATE INDEX "idx_role_permissions_permission_id" ON "role_permissions" ("permission_id")`,
  `CREATE INDEX "idx_role_permissions_role_id" ON "role_permissions" ("role_id")`,
  `ALTER TABLE "feature_flag_rules" ADD CONSTRAINT "FK_feature_flag_rules_flag_id" FOREIGN KEY ("flag_id") REFERENCES "feature_flags"("id") ON DELETE CASCADE`,
  `ALTER TABLE "permissions" ADD CONSTRAINT "FK_permissions_action" FOREIGN KEY ("action_id") REFERENCES "actions"("id") ON DELETE RESTRICT`,
  `ALTER TABLE "permissions" ADD CONSTRAINT "FK_permissions_resource" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE RESTRICT`,
  `ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_role_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE`,
  `ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_role_permissions_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE`
];

const ROWS: readonly string[] = [
  `INSERT INTO "actions" ("id", "name") VALUES
    ('4944873d-a53f-47d5-ba18-e054a0d354f7', 'create'),
    ('68d2e248-7d38-4292-852c-5e0fafc9588a', 'read'),
    ('ba2e2b21-6672-4be9-925f-33539e3dd3af', 'update'),
    ('2fb150b5-a15a-4502-9946-f2a912f85267', 'delete'),
    ('764d3bfb-6de5-4ff5-b88e-e2e9a2aac3e4', 'search'),
    ('7caa1ec2-8940-4926-8a10-ef491c2502a0', 'assign')`,
  `INSERT INTO "resources" ("id", "name", "subject", "display_name", "description", "is_system", "last_synced_at", "allowed_action_names", "is_orphaned", "action_names", "conditional_action_names") VALUES
    ('e2b80a63-3f1d-49ae-aa85-9994e07ddd83', 'users', 'User', 'Users', 'User accounts management', true, now(), NULL, false, '{create,read,update,delete,search}', '{create,read,update,delete,search}'),
    ('0093a6ce-b924-4041-8608-87082601172a', 'permissions', 'Permission', 'Permissions', 'Permission and RBAC metadata management', true, now(), NULL, false, '{read,update}', '{update}'),
    ('3409eb4d-d65e-4c3c-a547-97ab344e03de', 'roles', 'Role', 'Roles', 'Role management', true, now(), NULL, false, '{create,read,update,delete,assign}', '{create,update,delete}'),
    ('08a342c8-6af6-41d5-bcd1-c40469cd0efc', 'profile', 'Profile', 'Profile', 'User own profile', true, now(), NULL, false, '{update}', '{}')`,
  `INSERT INTO "permissions" ("id", "description", "resource_id", "action_id") VALUES
    ('9f9f007e-d5f6-49fb-a7ba-12a7c44658c9', 'Create new users', 'e2b80a63-3f1d-49ae-aa85-9994e07ddd83', '4944873d-a53f-47d5-ba18-e054a0d354f7'),
    ('183d27e1-c2f4-4a35-82ec-daf938b82aab', 'View user details', 'e2b80a63-3f1d-49ae-aa85-9994e07ddd83', '68d2e248-7d38-4292-852c-5e0fafc9588a'),
    ('05c22638-f379-4834-9b0e-ecf8f9668a38', 'Update user information', 'e2b80a63-3f1d-49ae-aa85-9994e07ddd83', 'ba2e2b21-6672-4be9-925f-33539e3dd3af'),
    ('39e12fac-532e-4b7e-bac5-1be65073b2f0', 'Delete users', 'e2b80a63-3f1d-49ae-aa85-9994e07ddd83', '2fb150b5-a15a-4502-9946-f2a912f85267'),
    ('19dd447e-5735-4aab-9256-198f7cae8f93', 'Search users', 'e2b80a63-3f1d-49ae-aa85-9994e07ddd83', '764d3bfb-6de5-4ff5-b88e-e2e9a2aac3e4'),
    ('1c756262-58a5-42b3-843f-e69ff4e9dfa7', 'Update own profile', '08a342c8-6af6-41d5-bcd1-c40469cd0efc', 'ba2e2b21-6672-4be9-925f-33539e3dd3af'),
    ('730adf22-8ed9-442c-92c3-522fda7b78eb', 'Create new roles', '3409eb4d-d65e-4c3c-a547-97ab344e03de', '4944873d-a53f-47d5-ba18-e054a0d354f7'),
    ('0635974b-3191-4efb-80c0-8fbe4aa21b3b', 'View roles', '3409eb4d-d65e-4c3c-a547-97ab344e03de', '68d2e248-7d38-4292-852c-5e0fafc9588a'),
    ('3fc0e804-9491-4bcc-9aa4-cb7a809ed575', 'Update roles', '3409eb4d-d65e-4c3c-a547-97ab344e03de', 'ba2e2b21-6672-4be9-925f-33539e3dd3af'),
    ('15b2ec1c-df80-45ac-b954-d8cef34f081c', 'Delete roles', '3409eb4d-d65e-4c3c-a547-97ab344e03de', '2fb150b5-a15a-4502-9946-f2a912f85267'),
    ('0dbdde9f-46d3-42ef-be84-41b58e8e4e74', 'Assign roles to users', '3409eb4d-d65e-4c3c-a547-97ab344e03de', '7caa1ec2-8940-4926-8a10-ef491c2502a0'),
    ('c0f6eed4-05d0-4c69-a36d-85d0e3979412', NULL, '0093a6ce-b924-4041-8608-87082601172a', '68d2e248-7d38-4292-852c-5e0fafc9588a'),
    ('aba3883c-6301-4587-8f22-2a122e7a77fb', NULL, '0093a6ce-b924-4041-8608-87082601172a', 'ba2e2b21-6672-4be9-925f-33539e3dd3af')`,
  `INSERT INTO "roles" ("id", "name", "description", "is_system", "is_super") VALUES
    ('5764a163-6f20-4015-a27f-7dc367dd3d4f', 'user', 'Regular user with basic access', true, false),
    ('3a956269-d242-4a0e-aa25-f8d3e58d72c4', 'admin', 'System administrator with full access', true, true)`,
  `INSERT INTO "role_permissions" ("id", "role_id", "permission_id") VALUES
    ('2bd781f8-f643-49ec-9561-29124f2317d2', '3a956269-d242-4a0e-aa25-f8d3e58d72c4', '9f9f007e-d5f6-49fb-a7ba-12a7c44658c9'),
    ('8e8b82fc-399f-473c-acac-416ddd82e94c', '3a956269-d242-4a0e-aa25-f8d3e58d72c4', '183d27e1-c2f4-4a35-82ec-daf938b82aab'),
    ('2f1b19b6-dd01-4644-90e5-1a86c272615d', '3a956269-d242-4a0e-aa25-f8d3e58d72c4', '05c22638-f379-4834-9b0e-ecf8f9668a38'),
    ('d9654e41-1c30-47d3-baff-98059f4f6254', '3a956269-d242-4a0e-aa25-f8d3e58d72c4', '39e12fac-532e-4b7e-bac5-1be65073b2f0'),
    ('aa65cab7-4216-44b7-98a7-5209a5606849', '3a956269-d242-4a0e-aa25-f8d3e58d72c4', '19dd447e-5735-4aab-9256-198f7cae8f93'),
    ('72c5b4e6-0852-4b96-9f8c-0af5a90b0014', '3a956269-d242-4a0e-aa25-f8d3e58d72c4', '1c756262-58a5-42b3-843f-e69ff4e9dfa7'),
    ('35fa731f-e43c-4b1e-acd2-ae645d41087b', '3a956269-d242-4a0e-aa25-f8d3e58d72c4', '730adf22-8ed9-442c-92c3-522fda7b78eb'),
    ('5884f06d-10ba-4860-b706-1374785a4df6', '3a956269-d242-4a0e-aa25-f8d3e58d72c4', '0635974b-3191-4efb-80c0-8fbe4aa21b3b'),
    ('65047a8e-510d-4ce2-8221-e25bbf1032b1', '3a956269-d242-4a0e-aa25-f8d3e58d72c4', '3fc0e804-9491-4bcc-9aa4-cb7a809ed575'),
    ('2718a604-f7e5-4b44-b16a-ab8938c15bda', '3a956269-d242-4a0e-aa25-f8d3e58d72c4', '15b2ec1c-df80-45ac-b954-d8cef34f081c'),
    ('da3466a6-1f71-488e-837a-de134f45c7d0', '3a956269-d242-4a0e-aa25-f8d3e58d72c4', '0dbdde9f-46d3-42ef-be84-41b58e8e4e74'),
    ('20f46e55-21b2-470e-91d9-53afcf985828', '5764a163-6f20-4015-a27f-7dc367dd3d4f', '1c756262-58a5-42b3-843f-e69ff4e9dfa7'),
    ('f972562d-32f2-4f3a-9fad-0bc56b320fdd', '3a956269-d242-4a0e-aa25-f8d3e58d72c4', 'c0f6eed4-05d0-4c69-a36d-85d0e3979412'),
    ('0fd20d8f-4171-4192-b220-ad85ebf618f3', '3a956269-d242-4a0e-aa25-f8d3e58d72c4', 'aba3883c-6301-4587-8f22-2a122e7a77fb')`,
  `INSERT INTO "feature_flags" ("id", "key", "description", "enabled", "environments", "public", "version") VALUES
    ('f3fd514c-3b92-4bf8-8c31-e2980931868f', 'oauth-google', 'Show the google OAuth login button (gated by provider configuration)', true, '{}', true, 1),
    ('62c32069-e22e-41e8-a128-8016c28fd98d', 'oauth-facebook', 'Show the facebook OAuth login button (gated by provider configuration)', true, '{}', true, 1),
    ('b23e3e08-1182-487f-8c32-216a41e7f162', 'oauth-vk', 'Show the vk OAuth login button (gated by provider configuration)', true, '{}', true, 1),
    ('541e99ca-113a-4392-86b7-54f7554df60f', 'billing', 'Show billing (gated by at least one provider being configured)', true, '{}', true, 1),
    ('7fde3db9-a07d-4da8-a307-ed66cfccb9cd', 'billing-paddle', 'Admin kill-switch enabling the paddle billing provider', false, '{}', false, 3),
    ('863e475e-a69e-4d3e-b985-647e86d354eb', 'billing-yookassa', 'Admin kill-switch enabling the yookassa billing provider', false, '{}', false, 3)`,
  `INSERT INTO "feature_flag_rules" ("id", "flag_id", "effect", "payload") VALUES
    ('739e9354-5e09-42ab-8176-8c6be48cb40f', 'f3fd514c-3b92-4bf8-8c31-e2980931868f', 'include', '{"op": "eq", "type": "attribute", "field": "custom", "value": true, "customKey": "oauthGoogleConfigured"}'),
    ('7c675510-d410-4aca-9848-96fa1ecf5bbe', '62c32069-e22e-41e8-a128-8016c28fd98d', 'include', '{"op": "eq", "type": "attribute", "field": "custom", "value": true, "customKey": "oauthFacebookConfigured"}'),
    ('b2df5260-adcb-4151-985b-21c073dc16a9', 'b23e3e08-1182-487f-8c32-216a41e7f162', 'include', '{"op": "eq", "type": "attribute", "field": "custom", "value": true, "customKey": "oauthVkConfigured"}'),
    ('463788d1-50eb-4df5-a2dc-b2e3e01e31a0', '541e99ca-113a-4392-86b7-54f7554df60f', 'include', '{"op": "eq", "type": "attribute", "field": "custom", "value": true, "customKey": "billingConfigured"}'),
    ('5c8dc932-563b-4e6c-a04b-c46bb0bebd39', '7fde3db9-a07d-4da8-a307-ed66cfccb9cd', 'include', '{"op": "eq", "type": "attribute", "field": "custom", "value": true, "customKey": "paddleConfigured"}'),
    ('bf60be90-9338-4b7e-9467-ac9f69cd8048', '863e475e-a69e-4d3e-b985-647e86d354eb', 'include', '{"op": "eq", "type": "attribute", "field": "custom", "value": true, "customKey": "yookassaConfigured"}')`,
  `INSERT INTO "settings_change_epoch" DEFAULT VALUES`
];

const LOGGED_TABLES: ReadonlyArray<{ table: string; args: string }> = [
  { table: 'actions', args: `'id'` },
  { table: 'billing_products', args: `'id', 'updated_at'` },
  { table: 'feature_flag_rules', args: `'flag_id', 'updated_at'` },
  { table: 'feature_flags', args: `'id', 'updated_at'` },
  { table: 'permissions', args: `'id'` },
  { table: 'plans', args: `'id', 'updated_at'` },
  { table: 'resources', args: `'id', 'last_synced_at'` },
  { table: 'role_permissions', args: `'role_id'` },
  { table: 'roles', args: `'id', 'updated_at'` }
];

const TABLES: readonly string[] = [
  'settings_change_epoch',
  'settings_change_log',
  'billing_products',
  'plans',
  'feature_flag_rules',
  'feature_flags',
  'role_permissions',
  'roles',
  'permissions',
  'resources',
  'actions'
];

export class SettingsBaseline1795600000000 implements MigrationInterface {
  name = 'SettingsBaseline1795600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of [...SCHEMA, ...ROWS]) {
      await queryRunner.query(statement);
    }

    for (const { table, args } of LOGGED_TABLES) {
      await queryRunner.query(
        `CREATE TRIGGER "TRG_${table}_settings_change_row" AFTER INSERT OR UPDATE OR DELETE ON "${table}" FOR EACH ROW EXECUTE FUNCTION "settings_change_log_write"(${args})`
      );
      await queryRunner.query(
        `CREATE TRIGGER "TRG_${table}_settings_change_truncate" AFTER TRUNCATE ON "${table}" FOR EACH STATEMENT EXECUTE FUNCTION "settings_change_log_write"(${args})`
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      await queryRunner.query(`DROP TABLE "${table}" CASCADE`);
    }

    await queryRunner.query(`DROP FUNCTION "settings_change_log_write"()`);
  }
}
