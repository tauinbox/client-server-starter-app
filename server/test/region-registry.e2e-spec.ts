import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { HOME_DATA_REGION } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { CoreModule } from '../src/modules/core/core.module';
import { RegionRegistryService } from '../src/modules/core/region-registry/region-registry.service';
import { settingsDataSourceOf } from './settings-data-source';

// The registry of the public regions on real Postgres: a status change is a
// settings write with one regional audit row and one change log entry, and a
// repeat writes neither. Runs only when DB_HOST is set.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

interface AuditRow {
  id: string;
  details: { public: boolean };
  settings_outcome: string | null;
}

runWithInfra('Region registry (e2e)', () => {
  const requestId = `region-registry-${Date.now()}`;

  let app: INestApplication;
  let dataSource: DataSource;
  let settingsDataSource: DataSource;
  let registry: RegionRegistryService;

  const actor = {
    actorId: null,
    actorEmail: 'admin@example.com',
    context: { requestId }
  };

  const auditRows = (): Promise<AuditRow[]> =>
    dataSource.query(
      `SELECT "id", "details", "settings_outcome" FROM "audit_logs"
       WHERE "request_id" = $1 AND "action" = $2 ORDER BY "created_at"`,
      [requestId, AuditAction.REGION_STATUS_UPDATE]
    );

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);
    settingsDataSource = settingsDataSourceOf(app);
    registry = app.get(RegionRegistryService);
    await settingsDataSource.query(
      `DELETE FROM "region_registry" WHERE "region" = 'ru'`
    );
  }, 60000);

  afterAll(async () => {
    await settingsDataSource.query(
      `DELETE FROM "region_registry" WHERE "region" = 'ru'`
    );
    await dataSource.query(`DELETE FROM "audit_logs" WHERE "request_id" = $1`, [
      requestId
    ]);
    await app.close();
  });

  it('lists only the home region while no other region has a public row', async () => {
    await expect(registry.publicRegions()).resolves.toEqual([HOME_DATA_REGION]);
  });

  it('opens a region with one audit row and one change log entry of that row', async () => {
    await expect(
      registry.setPublic('ru', { isPublic: true, actor })
    ).resolves.toEqual({ region: 'ru', public: true });

    await expect(registry.publicRegions()).resolves.toEqual([
      HOME_DATA_REGION,
      'ru'
    ]);

    const rows = await auditRows();

    expect(rows).toEqual([
      expect.objectContaining({
        details: { public: true },
        settings_outcome: 'applied'
      })
    ]);

    const entries = await settingsDataSource.query<
      Array<{ table_name: string; keys: unknown[] }>
    >(
      `SELECT "table_name", "keys" FROM "settings_change_log" WHERE "audit_id" = $1`,
      [rows[0].id]
    );

    expect(entries).toEqual([{ table_name: 'region_registry', keys: ['ru'] }]);
  });

  it('writes no audit row and no log entry for a repeat of the status', async () => {
    // Only this suite writes the registry, so the count of its entries is
    // still while other suites write other settings tables.
    const registryEntries = async () => {
      const [{ count }] = await settingsDataSource.query<
        Array<{ count: number }>
      >(
        `SELECT count(*)::int AS "count" FROM "settings_change_log"
         WHERE "table_name" = 'region_registry'`
      );

      return count;
    };
    const before = await registryEntries();

    await registry.setPublic('ru', { isPublic: true, actor });

    expect(await auditRows()).toHaveLength(1);
    expect(await registryEntries()).toBe(before);
  });

  it('closes the region again', async () => {
    await registry.setPublic('ru', { isPublic: false, actor });

    await expect(registry.publicRegions()).resolves.toEqual([HOME_DATA_REGION]);
    expect((await auditRows()).map(({ details }) => details)).toEqual([
      { public: true },
      { public: false }
    ]);
  });
});
