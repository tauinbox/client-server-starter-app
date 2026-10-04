import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes the permission data match the checks in the code.
 *
 * - `resources.action_names` and `conditional_action_names` hold what each
 *   `@RegisterResource` declares. The sync rewrites them on every start; the
 *   values here only cover the time before the first start.
 * - A grant on a pair that no route checks is deleted, with its permission
 *   row. Such a grant gave no access, and it would show in no matrix now.
 * - Every grant on `billing` and `feature-flags` is deleted. Their routes
 *   checked `manage`, which only a super role passes, so the grants gave
 *   nothing; their routes now check ordinary actions, and a deploy must not
 *   turn a forgotten checkbox into access.
 * - An action that no resource declares is deleted. Actions are now created
 *   by the sync from the code, not by an admin.
 * - An admin narrowing keeps only declared actions, and becomes NULL when it
 *   keeps all of them.
 * - `actions.is_default`, `display_name` and `description` are dropped: the
 *   declared lists replace the first, client translations the other two.
 *
 * Literals are inlined intentionally: migrations are historical records.
 */
export class AlignResourceActionsWithChecks1785700000000 implements MigrationInterface {
  private static readonly declared: ReadonlyArray<
    readonly [string, string[], string[]]
  > = [
    [
      'users',
      ['create', 'read', 'update', 'delete', 'search'],
      ['create', 'read', 'update', 'delete', 'search']
    ],
    [
      'roles',
      ['create', 'read', 'update', 'delete', 'assign'],
      ['create', 'update', 'delete']
    ],
    ['permissions', ['read', 'update'], ['update']],
    ['profile', ['update'], []],
    ['billing', ['search', 'create', 'update', 'refund'], []],
    ['feature-flags', ['create', 'read', 'update', 'delete', 'search'], []]
  ];

  private static readonly knownActions = [
    'create',
    'read',
    'update',
    'delete',
    'search',
    'assign',
    'refund'
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resources"
         ADD COLUMN "action_names" text[] NOT NULL DEFAULT '{}',
         ADD COLUMN "conditional_action_names" text[] NOT NULL DEFAULT '{}'`
    );

    for (const [
      name,
      actions,
      conditional
    ] of AlignResourceActionsWithChecks1785700000000.declared) {
      await queryRunner.query(
        `UPDATE "resources"
            SET "action_names" = $1::text[],
                "conditional_action_names" = $2::text[]
          WHERE "name" = $3`,
        [actions, conditional, name]
      );
    }

    await queryRunner.query(
      `DELETE FROM "role_permissions" rp
        USING "permissions" p, "resources" r
        WHERE rp."permission_id" = p."id"
          AND p."resource_id" = r."id"
          AND r."name" IN ('billing', 'feature-flags')`
    );

    // A pair is undeclared when its action is missing from a resource that
    // has a declared list, or when its action is unknown to the code at all.
    const undeclaredPermissions = `
      SELECT p."id" FROM "permissions" p
        JOIN "resources" r ON r."id" = p."resource_id"
        JOIN "actions" a ON a."id" = p."action_id"
       WHERE (cardinality(r."action_names") > 0
              AND NOT (a."name" = ANY(r."action_names")))
          OR NOT (a."name" = ANY($1::text[]))`;
    const knownActions =
      AlignResourceActionsWithChecks1785700000000.knownActions;
    await queryRunner.query(
      `DELETE FROM "role_permissions"
        WHERE "permission_id" IN (${undeclaredPermissions})`,
      [knownActions]
    );
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE "id" IN (${undeclaredPermissions})`,
      [knownActions]
    );
    await queryRunner.query(
      `DELETE FROM "actions" WHERE NOT ("name" = ANY($1::text[]))`,
      [knownActions]
    );

    await queryRunner.query(
      `UPDATE "resources"
          SET "allowed_action_names" = ARRAY(
            SELECT a FROM unnest("action_names") WITH ORDINALITY AS t(a, i)
             WHERE a = ANY("allowed_action_names")
             ORDER BY i
          )
        WHERE "allowed_action_names" IS NOT NULL
          AND cardinality("action_names") > 0`
    );
    await queryRunner.query(
      `UPDATE "resources" SET "allowed_action_names" = NULL
        WHERE "allowed_action_names" IS NOT NULL
          AND cardinality("action_names") > 0
          AND "allowed_action_names" @> "action_names"`
    );

    await queryRunner.query(
      `ALTER TABLE "actions"
         DROP COLUMN "is_default",
         DROP COLUMN "display_name",
         DROP COLUMN "description"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Deleted grants, permission rows and admin-created actions are not
    // restored: nothing records them, and none of them gave access.
    await queryRunner.query(
      `ALTER TABLE "actions"
         ADD COLUMN "is_default" boolean NOT NULL DEFAULT false,
         ADD COLUMN "display_name" varchar NOT NULL DEFAULT '',
         ADD COLUMN "description" varchar NOT NULL DEFAULT ''`
    );
    await queryRunner.query(
      `UPDATE "actions"
          SET "display_name" = initcap("name"),
              "is_default" = "name" IN ('create', 'read', 'update', 'delete', 'search')`
    );
    await queryRunner.query(
      `UPDATE "resources"
          SET "allowed_action_names" = ARRAY['create', 'read', 'update', 'delete', 'search', 'assign']
        WHERE "name" = 'roles'`
    );
    await queryRunner.query(
      `UPDATE "resources"
          SET "allowed_action_names" = ARRAY['read', 'update']
        WHERE "name" = 'profile'`
    );
    await queryRunner.query(
      `ALTER TABLE "resources"
         DROP COLUMN "conditional_action_names",
         DROP COLUMN "action_names"`
    );
  }
}
