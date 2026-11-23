import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  DataSource,
  DataSourceOptions,
  DeleteResult,
  MigrationInterface,
  QueryRunner,
  Repository
} from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { postgresConfig } from '../src/postgres.config';
import { runBootSteps } from '../src/run-boot-steps';
import { AuditCleanupService } from '../src/modules/audit/audit-cleanup.service';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { TokenCleanupService } from '../src/modules/auth/services/token-cleanup.service';
import { RefreshTokenService } from '../src/modules/auth/services/refresh-token.service';
import { ResourceSyncService } from '../src/modules/auth/services/resource-sync.service';
import { ResourceService } from '../src/modules/auth/services/resource.service';
import { waitUntil } from './eventually';
import { waitsOnLock } from './lock-wait';

// The advisory locks live in Postgres, so two connections stand for two nodes
// of one pool. Runs only when DB_HOST is set: CI provides Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const PROBE_TABLE = 'boot_steps_probe';

class BootStepsProbe1999999999999 implements MigrationInterface {
  name = 'BootStepsProbe1999999999999';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SELECT count(*) FROM "${PROBE_TABLE}"`);
  }

  async down(): Promise<void> {}
}

function gate(): { opened: Promise<void>; open: () => void } {
  const { promise, resolve } = Promise.withResolvers<void>();

  return { opened: promise, open: () => resolve() };
}

runWithInfra('jobs on many nodes of one pool (e2e)', () => {
  describe('image boot steps', () => {
    const ENV = process.env;
    const adminEmail = `boot-steps-${Date.now()}@example.com`;
    const config = postgresConfig();
    const migrations = Array.isArray(config.migrations)
      ? config.migrations
      : [];
    const nodeOptions: DataSourceOptions = {
      ...config,
      logging: false,
      migrations: [...migrations, BootStepsProbe1999999999999]
    };

    let holder: DataSource;
    let nodes: DataSource[];

    beforeAll(async () => {
      process.env = {
        ...ENV,
        ADMIN_EMAIL: adminEmail,
        ADMIN_PASSWORD: 'Quartz-Lantern-Meadow-4821',
        PWNED_PASSWORDS_RANGE_URL: 'http://127.0.0.1:1/range'
      };
      holder = new DataSource({ ...config, logging: false });
      await holder.initialize();
      await holder.query(
        `CREATE TABLE IF NOT EXISTS "${PROBE_TABLE}" (id int)`
      );
      nodes = [new DataSource(nodeOptions), new DataSource(nodeOptions)];
      await Promise.all(nodes.map((node) => node.initialize()));
    }, 60000);

    afterAll(async () => {
      process.env = ENV;
      await Promise.all(
        (nodes ?? [])
          .filter((node) => node.isInitialized)
          .map((node) => node.destroy())
      );

      if (holder?.isInitialized) {
        await holder.query('DELETE FROM "migrations" WHERE "name" = $1', [
          new BootStepsProbe1999999999999().name
        ]);
        await holder.query('DELETE FROM "users" WHERE "email" = $1', [
          adminEmail
        ]);
        await holder.query(`DROP TABLE IF EXISTS "${PROBE_TABLE}"`);
        await holder.destroy();
      }
    });

    it('applies a pending migration and seeds the admin once when two nodes start at once', async () => {
      // The holder blocks the pending migration, so both nodes start their
      // steps before either one can finish them.
      const lock = holder.createQueryRunner();

      await lock.connect();
      await lock.startTransaction();
      await lock.query(`LOCK TABLE "${PROBE_TABLE}" IN ACCESS EXCLUSIVE MODE`);

      const runs = nodes.map((node) => runBootSteps(node));

      try {
        await waitUntil('both nodes wait on a lock', async () => {
          const [{ waiting }] = await holder.query<Array<{ waiting: number }>>(
            `SELECT count(*)::int AS waiting FROM pg_stat_activity
              WHERE datname = current_database()
                AND wait_event_type = 'Lock'
                AND (query ILIKE $1 OR query ILIKE $2)`,
            [`%${PROBE_TABLE}%`, '%pg_advisory_xact_lock%']
          );

          return waiting >= 2 ? true : null;
        });
      } finally {
        await lock.commitTransaction();
        await lock.release();
      }

      const results = await Promise.allSettled(runs);

      expect(results.map(({ status }) => status)).toEqual([
        'fulfilled',
        'fulfilled'
      ]);

      const [{ applied }] = await holder.query<Array<{ applied: number }>>(
        'SELECT count(*)::int AS applied FROM "migrations" WHERE "name" = $1',
        [new BootStepsProbe1999999999999().name]
      );
      const [{ admins }] = await holder.query<Array<{ admins: number }>>(
        'SELECT count(*)::int AS admins FROM "users" WHERE "email" = $1',
        [adminEmail]
      );

      expect({ applied, admins }).toEqual({ applied: 1, admins: 1 });
    }, 60000);
  });

  describe('scheduled and boot jobs of the app', () => {
    let app: INestApplication;
    let dataSource: DataSource;

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [CoreModule.forRoot()]
      }).compile();

      app = moduleRef.createNestApplication();
      await app.init();
      dataSource = app.get(DataSource);
    }, 60000);

    afterAll(async () => {
      await app?.close();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('runs the audit log cleanup on one node when two nodes fire it at once', async () => {
      const cleanup = app.get(AuditCleanupService);
      const repository = app.get<Repository<AuditLog>>(
        getRepositoryToken(AuditLog)
      );
      const held = gate();
      const remove = jest
        .spyOn(repository, 'delete')
        .mockImplementationOnce(async () => {
          await held.opened;

          return { affected: 0, raw: [] } satisfies DeleteResult;
        });

      const first = cleanup.handleDailyAuditLogCleanup();

      await waitUntil('the first node runs the delete', () =>
        Promise.resolve(remove.mock.calls.length > 0 ? true : null)
      );
      await cleanup.handleDailyAuditLogCleanup();

      expect(remove).toHaveBeenCalledTimes(1);

      held.open();
      await first;
    });

    it('runs the refresh token cleanup on one node when two nodes fire it at once', async () => {
      const cleanup = app.get(TokenCleanupService);
      const tokens = app.get(RefreshTokenService);
      const held = gate();
      const remove = jest
        .spyOn(tokens, 'removeExpiredTokens')
        .mockImplementationOnce(async () => {
          await held.opened;

          return 0;
        });

      const first = cleanup.handleDailyTokenCleanup();

      await waitUntil('the first node runs the delete', () =>
        Promise.resolve(remove.mock.calls.length > 0 ? true : null)
      );
      await cleanup.handleDailyTokenCleanup();

      expect(remove).toHaveBeenCalledTimes(1);

      held.open();
      await first;
    });

    it('runs the resource sync of a second node after the first one ends', async () => {
      const sync = app.get(ResourceSyncService);
      const resources = app.get(ResourceService);
      const held = gate();
      const original = resources.upsertResource.bind(resources);
      const upsert = jest
        .spyOn(resources, 'upsertResource')
        .mockImplementationOnce(async (...args) => {
          await held.opened;

          return original(...args);
        });

      const first = sync.onApplicationBootstrap();

      await waitUntil('the first node syncs', () =>
        Promise.resolve(upsert.mock.calls.length > 0 ? true : null)
      );

      const second = sync.onApplicationBootstrap();
      const secondWaits = await waitsOnLock(
        dataSource,
        '%pg_advisory_xact_lock%'
      );
      const callsWhileHeld = upsert.mock.calls.length;

      held.open();
      await Promise.all([first, second]);

      expect({ secondWaits, callsWhileHeld }).toEqual({
        secondWaits: true,
        callsWhileHeld: 1
      });
    }, 30000);
  });
});
