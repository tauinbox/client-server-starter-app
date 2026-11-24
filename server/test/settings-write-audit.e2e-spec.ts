import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { ErrorKeys } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditService } from '../src/modules/audit/audit.service';
import type { AuditLogParams } from '../src/modules/audit/audit.service';
import { SettingsWriteSettleService } from '../src/modules/audit/settings-write-settle.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { Role } from '../src/modules/auth/entities/role.entity';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { ApiError } from '../src/common/errors/api-error';
import {
  SettingsChangeLogService,
  writeSettings
} from '../src/modules/core/settings-change-log/settings-change-log.service';
import type { SettingsWrite } from '../src/modules/core/settings-change-log/settings-change-log.service';

// The audit row of a settings write on real Postgres: it is committed before
// the write, the change log entries of the write carry its id, and its outcome
// follows the write. Runs only when DB_HOST is set.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

interface AuditRow {
  id: string;
  target_id: string | null;
  settings_outcome: string | null;
}

runWithInfra('Settings write audit row (e2e)', () => {
  const tag = `settings-audit-${Date.now()}`;

  let app: INestApplication;
  let dataSource: DataSource;
  let auditService: AuditService;
  let roleService: RoleService;
  let settingsChangeLog: SettingsChangeLogService;

  const params = (name: string): AuditLogParams => ({
    action: AuditAction.ROLE_CREATE,
    targetType: 'Role',
    details: { name },
    context: { requestId: tag }
  });

  const rowsOfRequest = (): Promise<AuditRow[]> =>
    dataSource.query(
      `SELECT "id", "target_id", "settings_outcome" FROM "audit_logs"
       WHERE "request_id" = $1 ORDER BY "created_at"`,
      [tag]
    );

  const logEntriesOf = (
    auditId: string
  ): Promise<Array<{ table_name: string }>> =>
    dataSource.query(
      `SELECT "table_name" FROM "settings_change_log" WHERE "audit_id" = $1`,
      [auditId]
    );

  /** A settings write through the funnel, with this suite as its audit trail. */
  const audited = <T>(
    draft: AuditLogParams,
    write: SettingsWrite<T>,
    manager: { transaction: DataSource['transaction'] } = dataSource
  ) =>
    writeSettings(
      manager,
      { log: settingsChangeLog, audit: { trail: auditService, draft } },
      write
    );

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
    auditService = app.get(AuditService);
    roleService = app.get(RoleService);
    settingsChangeLog = app.get(SettingsChangeLogService);
  }, 60000);

  afterEach(async () => {
    await dataSource.query(`DELETE FROM "audit_logs" WHERE "request_id" = $1`, [
      tag
    ]);
    await dataSource.query(`DELETE FROM "roles" WHERE "name" LIKE $1`, [
      `${tag}%`
    ]);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a committed write leaves an applied row, and its log entries carry the id of the row', async () => {
    const name = `${tag}-created`;
    const role = await roleService.create(
      { name },
      {
        ability: SYSTEM_ABILITY,
        audit: (created) => ({ ...params(name), targetId: created.id })
      }
    );
    const [row] = await rowsOfRequest();

    expect(row).toMatchObject({
      target_id: role.id,
      settings_outcome: 'applied'
    });
    expect(await logEntriesOf(row.id)).toEqual([{ table_name: 'roles' }]);
  });

  it('the row of the locked record replaces the draft after the commit', async () => {
    const name = `${tag}-final`;

    await audited(
      { ...params(name), details: { phase: 'draft', stale: true } },
      async (em, recordAudit) => {
        await em.insert(Role, { name, isSuper: false });
        recordAudit({ ...params(name), details: { phase: 'final' } });
      }
    );

    const [row] = await dataSource.query<
      Array<{ details: unknown; settings_outcome: string }>
    >(
      `SELECT "details", "settings_outcome" FROM "audit_logs" WHERE "request_id" = $1`,
      [tag]
    );

    expect(row).toEqual({
      details: { phase: 'final' },
      settings_outcome: 'applied'
    });
  });

  it('a write that fails after its row is committed leaves the row not applied and no log entry', async () => {
    const name = `${tag}-failed`;

    await expect(
      audited(params(name), async (em) => {
        await em.insert(Role, { name, isSuper: false });

        throw new Error('fault after the insert');
      })
    ).rejects.toThrow('fault after the insert');

    const [row] = await rowsOfRequest();

    expect(row.settings_outcome).toBe('not_applied');
    expect(await logEntriesOf(row.id)).toEqual([]);
    expect(await dataSource.getRepository(Role).countBy({ name })).toBe(0);
  });

  it('a refused write deletes its row', async () => {
    await expect(
      audited(params(`${tag}-refused`), () =>
        Promise.reject(
          new ApiError(ErrorKeys.ROLES.NOT_FOUND, 'Role not found')
        )
      )
    ).rejects.toMatchObject({ errorKey: ErrorKeys.ROLES.NOT_FOUND });

    expect(await rowsOfRequest()).toEqual([]);
  });

  it('a later write on the same connection carries no audit id', async () => {
    const runner = dataSource.createQueryRunner();

    try {
      const { manager } = runner;

      await audited(
        params(`${tag}-first`),
        async (em) => {
          await em.insert(Role, { name: `${tag}-first`, isSuper: false });
        },
        manager
      );
      await writeSettings(manager, { log: settingsChangeLog }, async (em) => {
        await em.insert(Role, { name: `${tag}-second`, isSuper: false });
      });
    } finally {
      await runner.release();
    }

    const [{ id: second }] = await dataSource.query<Array<{ id: string }>>(
      `SELECT "id" FROM "roles" WHERE "name" = $1`,
      [`${tag}-second`]
    );
    const entries = await dataSource.query<Array<{ audit_id: string | null }>>(
      `SELECT "audit_id" FROM "settings_change_log"
       WHERE "table_name" = 'roles' AND "keys" @> $1::jsonb`,
      [JSON.stringify([second])]
    );

    expect(entries).toEqual([{ audit_id: null }]);
  });

  it('settles a row that a stopped node left pending from the change log', async () => {
    const name = `${tag}-settled`;

    await roleService.create(
      { name },
      {
        ability: SYSTEM_ABILITY,
        audit: (created) => ({ ...params(name), targetId: created.id })
      }
    );
    // The node stopped after the commit of the write: its row stays pending.
    const lost = await auditService.openSettingsWrite(params(`${tag}-lost`));

    await dataSource.query(
      `UPDATE "audit_logs" SET "settings_outcome" = 'pending',
         "created_at" = now() - interval '11 minutes'
       WHERE "request_id" = $1`,
      [tag]
    );
    // A pending row that is younger than the limit stays pending.
    const young = await auditService.openSettingsWrite(params(`${tag}-young`));

    await app.get(SettingsWriteSettleService).settle();

    const outcomes = Object.fromEntries(
      (await rowsOfRequest()).map((row) => [row.id, row.settings_outcome])
    );
    const [applied] = Object.keys(outcomes).filter(
      (id) => id !== lost && id !== young
    );

    expect(outcomes).toEqual({
      [applied]: 'applied',
      [lost]: 'not_applied',
      [young]: 'pending'
    });
  });
});
