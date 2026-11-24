import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { User } from '../src/modules/users/entities/user.entity';
import { UserRole } from '../src/modules/users/entities/user-role.entity';
import {
  lockSettingsLog,
  SettingsChangeLogService
} from '../src/modules/core/settings-change-log/settings-change-log.service';
import { SETTINGS_TABLES } from '../src/modules/core/settings-change-log/settings-change.types';
import { waitsOnLock } from './lock-wait';
import { waitUntil } from './eventually';

// The settings change log on real Postgres: the triggers, the order of the
// versions, the apply after a write and after a direct SQL write, and the
// rebase after a restore. Runs only when DB_HOST is set.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;
const { REDIS_URL } = process.env;
const runWithRedis =
  process.env['DB_HOST'] && REDIS_URL ? describe : describe.skip;

const RENEW_EPOCH_SQL = readFileSync(
  join(__dirname, '..', '..', 'scripts', 'restore-renew-settings-epoch.sql'),
  'utf8'
);

async function bootApp(): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [CoreModule.forRoot()]
  }).compile();
  const app = moduleRef.createNestApplication();

  await app.init();
  jest.spyOn(app.get(AuditService), 'log').mockResolvedValue(undefined);
  jest
    .spyOn(app.get(AuditService), 'logFireAndForget')
    .mockImplementation(() => undefined);

  return app;
}

/** The log entries of one table whose keys name `key`. */
async function entriesFor(
  dataSource: DataSource,
  { table, key }: { table: string; key: string }
): Promise<Array<{ version: string; operation: string }>> {
  return dataSource.query(
    `SELECT "version", "operation" FROM "settings_change_log"
     WHERE "table_name" = $1 AND "keys" @> $2::jsonb ORDER BY "version"`,
    [table, JSON.stringify([key])]
  );
}

runWithInfra('Settings change log (e2e)', () => {
  const tag = `settings-log-${Date.now()}`;
  const email = `${tag}@example.com`;

  let app: INestApplication;
  let dataSource: DataSource;
  let roleService: RoleService;
  let permissionService: PermissionService;
  let settingsChangeLog: SettingsChangeLogService;
  let holder: User;

  beforeAll(async () => {
    app = await bootApp();
    dataSource = app.get(DataSource);
    roleService = app.get(RoleService);
    permissionService = app.get(PermissionService);
    settingsChangeLog = app.get(SettingsChangeLogService);

    const users = dataSource.getRepository(User);

    holder = await users.save(
      users.create({
        email,
        name: 'Settings Log',
        isEmailVerified: true,
        password: null
      })
    );
  }, 60000);

  afterAll(async () => {
    jest.restoreAllMocks();

    if (dataSource) {
      await dataSource.getRepository(User).delete({ email });
      await dataSource.query(`DELETE FROM "roles" WHERE "name" LIKE $1`, [
        `${tag}%`
      ]);
    }

    await app?.close();
  });

  async function permissionId(
    action: string,
    subject: string
  ): Promise<string> {
    const permissions = await dataSource.getRepository(Permission).find();
    const found = permissions.find(
      (p) => p.action.name === action && p.resource.subject === subject
    );

    if (!found) throw new Error(`Permission ${action}:${subject} missing`);

    return found.id;
  }

  it('has a row trigger and a TRUNCATE trigger on each settings table and on no other table', async () => {
    const rows = await dataSource.query<
      Array<{ table_name: string; trigger_name: string }>
    >(
      `SELECT c.relname AS table_name, t.tgname AS trigger_name
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE NOT t.tgisinternal
         AND n.nspname = current_schema()
         AND pg_get_triggerdef(t.oid) LIKE '%settings_change_log_write%'`
    );
    const triggersOf = (kind: string) =>
      rows
        .filter(({ trigger_name: name }) => name.endsWith(kind))
        .map(({ table_name: table }) => table)
        .toSorted();

    expect(triggersOf('_settings_change_row')).toEqual(
      [...SETTINGS_TABLES].toSorted()
    );
    expect(triggersOf('_settings_change_truncate')).toEqual(
      [...SETTINGS_TABLES].toSorted()
    );
    expect(rows).toHaveLength(SETTINGS_TABLES.length * 2);
  });

  it('writes an entry for a change and none for an update that changes nothing or only an ignored column', async () => {
    const role = await roleService.create(
      { name: `${tag}-entry` },
      { ability: SYSTEM_ABILITY }
    );

    expect(
      (await entriesFor(dataSource, { table: 'roles', key: role.id })).map(
        ({ operation }) => operation
      )
    ).toEqual(['INSERT']);

    await dataSource.query(
      `UPDATE "roles" SET "description" = "description" WHERE "id" = $1`,
      [role.id]
    );
    await dataSource.query(
      `UPDATE "roles" SET "updated_at" = now() WHERE "id" = $1`,
      [role.id]
    );
    expect(
      await entriesFor(dataSource, { table: 'roles', key: role.id })
    ).toHaveLength(1);

    await dataSource.query(
      `UPDATE "roles" SET "description" = 'changed' WHERE "id" = $1`,
      [role.id]
    );
    expect(
      (await entriesFor(dataSource, { table: 'roles', key: role.id })).map(
        ({ operation }) => operation
      )
    ).toEqual(['INSERT', 'UPDATE']);
  });

  it('orders the versions by commit: a write waits for the log lock of an open settings write', async () => {
    const first = dataSource.createQueryRunner();
    const second = dataSource.createQueryRunner();

    await first.connect();
    await second.connect();

    try {
      await first.startTransaction();
      await lockSettingsLog(first.manager);
      await first.query(
        `INSERT INTO "roles" ("name", "is_system", "is_super") VALUES ($1, false, false)`,
        [`${tag}-first`]
      );

      // A direct SQL write: only the trigger takes the lock.
      const secondInsert = second.query(
        `INSERT INTO "roles" ("name", "is_system", "is_super") VALUES ($1, false, false)`,
        [`${tag}-second`]
      );

      expect(await waitsOnLock(dataSource, '%INSERT INTO "roles"%')).toBe(true);
      await first.commitTransaction();
      await secondInsert;

      const versions = await dataSource.query<
        Array<{ name: string; version: string }>
      >(
        `SELECT r."name", l."version" FROM "settings_change_log" l
         JOIN "roles" r ON l."keys" @> to_jsonb(ARRAY[r."id"::text])
         WHERE l."table_name" = 'roles' AND r."name" = ANY($1)
         ORDER BY l."version"`,
        [[`${tag}-first`, `${tag}-second`]]
      );

      expect(versions.map(({ name }) => name)).toEqual([
        `${tag}-first`,
        `${tag}-second`
      ]);
    } finally {
      if (first.isTransactionActive) await first.rollbackTransaction();

      await first.release();
      await second.release();
    }
  });

  it('a role delete answers after the holder lost the role, and the apply deletes its membership rows', async () => {
    const role = await roleService.create(
      { name: `${tag}-deleted` },
      { ability: SYSTEM_ABILITY }
    );

    await roleService.setPermissionsForRole(
      role.id,
      [{ permissionId: await permissionId('delete', 'Role') }],
      { ability: SYSTEM_ABILITY }
    );
    await roleService.assignRoleToUser(holder.id, role.id, {
      ability: SYSTEM_ABILITY
    });
    // Cached before the delete.
    expect(
      (await permissionService.getRolesForUser(holder.id)).map((r) => r.name)
    ).toContain(`${tag}-deleted`);

    await roleService.delete(role.id, { ability: SYSTEM_ABILITY });

    expect(
      (await permissionService.getRolesForUser(holder.id)).map((r) => r.name)
    ).not.toContain(`${tag}-deleted`);
    expect(
      await dataSource
        .getRepository(UserRole)
        .count({ where: { roleId: role.id } })
    ).toBe(0);
  });

  it('a grant written in SQL, as a seeder writes it, reaches a cached list through the poll', async () => {
    const role = await roleService.create(
      { name: `${tag}-seeded` },
      { ability: SYSTEM_ABILITY }
    );

    await roleService.assignRoleToUser(holder.id, role.id, {
      ability: SYSTEM_ABILITY
    });
    const before = await permissionService.getPermissionsForUser(holder.id);
    const readRole = await permissionId('read', 'Role');

    await dataSource.query(
      `INSERT INTO "role_permissions" ("role_id", "permission_id") VALUES ($1, $2)`,
      [role.id, readRole]
    );

    // With Redis a poll skips while another node of the pool applies; that
    // node drops the shared cache, so the test waits for the effect.
    const after = await waitUntil(
      'the poll applied the grant written in SQL',
      async () => {
        await settingsChangeLog.poll();
        const permissions = await permissionService.getPermissionsForUser(
          holder.id
        );

        return permissions.length > before.length ? permissions : null;
      },
      { timeoutMs: 15_000 }
    );

    expect(after.map(({ action }) => action)).toContain('read');
  });

  it('rebases after the restore renews the epoch: a cached list that no log entry names is dropped', async () => {
    const role = await roleService.create(
      { name: `${tag}-restored` },
      { ability: SYSTEM_ABILITY }
    );

    await roleService.assignRoleToUser(holder.id, role.id, {
      ability: SYSTEM_ABILITY
    });
    expect(
      (await permissionService.getRolesForUser(holder.id)).map((r) => r.name)
    ).toContain(`${tag}-restored`);

    // A row that a restored dump brings back: written with no log entry.
    const runner = dataSource.createQueryRunner();

    await runner.connect();

    try {
      await runner.query(`SET session_replication_role = replica`);
      await runner.query(`UPDATE "roles" SET "name" = $1 WHERE "id" = $2`, [
        `${tag}-from-dump`,
        role.id
      ]);
    } finally {
      await runner.query(`SET session_replication_role = DEFAULT`);
      await runner.release();
    }

    await dataSource.query(RENEW_EPOCH_SQL);

    // Any node of the pool can take the rebase; the cache is shared.
    const names = await waitUntil(
      'a rebase dropped the cached roles',
      async () => {
        await settingsChangeLog.applyPending();
        const roles = (await permissionService.getRolesForUser(holder.id)).map(
          (r) => r.name
        );

        return roles.includes(`${tag}-from-dump`) ? roles : null;
      },
      { timeoutMs: 15_000 }
    );

    expect(names).not.toContain(`${tag}-restored`);
  });
});

runWithRedis('Settings change log with the cache in Redis (e2e)', () => {
  const previousPoolMax = process.env['DB_POOL_MAX'];
  let app: INestApplication;

  beforeAll(async () => {
    // Fewer connections than concurrent writes: each waiter holds one.
    process.env['DB_POOL_MAX'] = '3';
    app = await bootApp();
  }, 60000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();

    if (previousPoolMax === undefined) delete process.env['DB_POOL_MAX'];
    else process.env['DB_POOL_MAX'] = previousPoolMax;
  });

  it('applies on the connection of the pool lock, so waiters that hold every other connection cannot starve it', async () => {
    const settingsChangeLog = app.get(SettingsChangeLogService);
    const dataSource = app.get(DataSource);
    const tag = `settings-log-redis-${Date.now()}`;

    try {
      await dataSource.query(
        `INSERT INTO "roles" ("name", "is_system", "is_super") VALUES ($1, false, false)`,
        [tag]
      );
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => settingsChangeLog.applyPending())
      );

      expect(results.filter(({ status }) => status === 'rejected')).toEqual([]);
    } finally {
      await dataSource.query(`DELETE FROM "roles" WHERE "name" = $1`, [tag]);
    }
  }, 60000);
});
