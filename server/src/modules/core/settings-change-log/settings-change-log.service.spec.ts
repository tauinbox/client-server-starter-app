import type { Cache } from 'cache-manager';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { dataSourceDouble } from '../../../common/testing/data-source.double';
import { poolLockDataSource } from '../../../common/testing/pool-lock.mock';
import type { AuditLogParams } from '../../audit/audit.service';
import {
  SettingsChangeLogService,
  summarizeSettingsChanges,
  writeSettings,
  type SettingsWrite
} from './settings-change-log.service';
import type { SettingsChangedEvent } from './settings-changed.event';

type Row = {
  version: string;
  table_name: string;
  operation: string;
  keys: unknown[] | null;
};

const row = (
  version: number,
  [table, operation, ...keys]: [string, string, ...string[]]
): Row => ({
  version: String(version),
  table_name: table,
  operation,
  keys: keys.length > 0 ? keys : null
});

describe('writeSettings', () => {
  const draft: AuditLogParams = {
    action: AuditAction.ROLE_CREATE,
    targetType: 'Role'
  };

  function setup(
    regionalCommit: () => Promise<void>,
    write: SettingsWrite<string> = () => Promise.resolve('written')
  ) {
    const settings = dataSourceDouble({ query: jest.fn() });
    const regional = {
      transaction: jest.fn(async (run: (em: object) => Promise<unknown>) => {
        const result = await run({});

        await regionalCommit();

        return result;
      })
    };
    const trail = {
      openSettingsWrite: jest.fn().mockResolvedValue('audit-1'),
      closeSettingsWrite: jest.fn().mockResolvedValue(undefined),
      discardSettingsWrite: jest.fn().mockResolvedValue(undefined)
    };
    const log = { applyPending: jest.fn().mockResolvedValue(undefined) };

    return {
      trail,
      log,
      run: () =>
        writeSettings(
          // @ts-expect-error - partial DataSource doubles: transaction and query runners only
          { regional, settings },
          { log, audit: { trail, draft } },
          write
        )
    };
  }

  it('records an applied change and drops the caches when only the regional commit fails', async () => {
    const lost = new Error('regional commit lost');
    const { trail, log, run } = setup(() => Promise.reject(lost));

    await expect(run()).rejects.toBe(lost);
    expect(trail.closeSettingsWrite).toHaveBeenCalledWith('audit-1', {
      outcome: 'applied',
      params: draft
    });
    expect(log.applyPending).toHaveBeenCalledTimes(1);
  });

  it('records an applied change after both commits', async () => {
    const { trail, log, run } = setup(() => Promise.resolve());

    await expect(run()).resolves.toBe('written');
    expect(trail.closeSettingsWrite).toHaveBeenCalledWith('audit-1', {
      outcome: 'applied',
      params: draft
    });
    expect(log.applyPending).toHaveBeenCalledTimes(1);
  });

  it('leaves no audit row when the write records that it changed nothing', async () => {
    const { trail, run } = setup(
      () => Promise.resolve(),
      (_managers, recordAudit) => {
        recordAudit(null);

        return Promise.resolve('unchanged');
      }
    );

    await expect(run()).resolves.toBe('unchanged');
    expect(trail.discardSettingsWrite).toHaveBeenCalledWith('audit-1');
    expect(trail.closeSettingsWrite).not.toHaveBeenCalled();
  });
});

describe('summarizeSettingsChanges', () => {
  it('collects the tables, the roles of role rows and grant rows, and the deleted roles', () => {
    const change = summarizeSettingsChanges([
      row(1, ['roles', 'UPDATE', 'r-1']),
      row(2, ['role_permissions', 'INSERT', 'r-2']),
      row(3, ['role_permissions', 'DELETE', 'r-2']),
      row(4, ['roles', 'DELETE', 'r-3']),
      row(5, ['feature_flags', 'UPDATE', 'f-1'])
    ]);

    expect(change.all).toBe(false);
    expect([...change.tables]).toEqual([
      'roles',
      'role_permissions',
      'feature_flags'
    ]);
    expect(change.roleIds).toEqual(['r-1', 'r-2', 'r-3']);
    expect(change.deletedRoleIds).toEqual(['r-3']);
  });

  it.each([
    ['a TRUNCATE', row(1, ['plans', 'TRUNCATE'])],
    ['a table outside the settings set', row(1, ['users', 'UPDATE', 'u-1'])]
  ])('marks everything stale on %s', (_case, entry) => {
    expect(summarizeSettingsChanges([entry]).all).toBe(true);
  });
});

/**
 * The settings data source answers the queries of an apply from a fixed log:
 * the epoch, the bounds of the log and the entries after a version. The
 * regional data source gives the transaction of the apply, which reads no log.
 */
function fakeLog(state: { epoch: string; entries: Row[] }) {
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM "settings_change_epoch"')) {
      return Promise.resolve([{ epoch: state.epoch }]);
    }

    if (sql.includes('min("version")')) {
      const versions = state.entries.map(({ version }) => Number(version));

      return Promise.resolve([
        {
          first: versions.length > 0 ? String(Math.min(...versions)) : null,
          last: versions.length > 0 ? String(Math.max(...versions)) : null
        }
      ]);
    }

    if (sql.includes('"version" > $1')) {
      const [after, limit] = params as [number, number];

      return Promise.resolve(
        state.entries
          .filter(({ version }) => Number(version) > after)
          .slice(0, limit)
      );
    }

    return Promise.resolve([]);
  });
  // The log is a settings table: a read of it on the regional side fails.
  const regionalQuery = jest.fn(() =>
    Promise.reject(new Error('the regional side holds no settings log'))
  );
  const regional = {
    transaction: jest.fn(
      (work: (m: { query: typeof regionalQuery }) => unknown) =>
        work({ query: regionalQuery })
    )
  };
  const settings = { manager: { query } };

  return { regional, settings };
}

describe('SettingsChangeLogService with the memory cache (process scope)', () => {
  // The memory store: no Redis client behind the cache.
  const cache: Pick<Cache, 'stores'> = { stores: [] };
  let emitted: SettingsChangedEvent[];
  let emitAsync: jest.Mock;

  beforeEach(() => {
    emitted = [];
    emitAsync = jest.fn((_name: string, event: SettingsChangedEvent) => {
      emitted.push(event);

      return Promise.resolve([]);
    });
  });

  function service(state: { epoch: string; entries: Row[] }) {
    const { regional, settings } = fakeLog(state);
    const emitter: Pick<EventEmitter2, 'emitAsync'> = { emitAsync };

    return new SettingsChangeLogService(
      // @ts-expect-error partial mocks: `transaction` of the regional source, `manager.query` of the settings source
      regional,
      settings,
      cache,
      emitter,
      { writesSettings: true }
    );
  }

  it('rebases on the first apply of the process, then applies only newer entries', async () => {
    const state = {
      epoch: 'e-1',
      entries: [row(1, ['roles', 'UPDATE', 'r-1'])]
    };
    const log = service(state);

    await log.applyPending();
    expect(emitted.map(({ change }) => change.all)).toEqual([true]);
    expect(emitted.map(({ scope }) => scope)).toEqual(['process']);

    state.entries.push(row(2, ['plans', 'UPDATE', 'p-1']));
    await log.applyPending();
    expect(emitted).toHaveLength(2);
    expect(emitted[1].change.all).toBe(false);
    expect([...emitted[1].change.tables]).toEqual(['plans']);

    await log.applyPending();
    expect(emitted).toHaveLength(2);
  });

  it('rebases when the epoch changes (a restore of the settings)', async () => {
    const state = { epoch: 'e-1', entries: [row(1, ['roles', 'UPDATE'])] };
    const log = service(state);

    await log.applyPending();
    state.epoch = 'e-2';
    await log.applyPending();

    expect(emitted.map(({ change }) => change.all)).toEqual([true, true]);
  });

  it('rebases when the retention removed entries that the process did not apply', async () => {
    const state = { epoch: 'e-1', entries: [row(1, ['roles', 'UPDATE'])] };
    const log = service(state);

    await log.applyPending();
    state.entries = [row(5, ['roles', 'UPDATE'])];
    await log.applyPending();

    expect(emitted.map(({ change }) => change.all)).toEqual([true, true]);
  });

  it('keeps the applied version when a listener fails, so the next apply repeats the batch', async () => {
    const state = { epoch: 'e-1', entries: [] as Row[] };
    const log = service(state);

    await log.applyPending();
    state.entries.push(row(1, ['roles', 'UPDATE', 'r-1']));
    emitAsync.mockRejectedValueOnce(new Error('redis down'));

    await expect(log.applyPending()).rejects.toThrow('redis down');
    await log.applyPending();

    const batches = (
      emitAsync.mock.calls as [string, SettingsChangedEvent][]
    ).map(([, { change }]) => change.roleIds);

    // The rebase, the failed batch, then the same batch again.
    expect(batches).toEqual([[], ['r-1'], ['r-1']]);
  });

  it('runs one apply at a time in the process', async () => {
    const state = { epoch: 'e-1', entries: [] as Row[] };
    const log = service(state);
    let active = 0;
    let most = 0;

    emitAsync.mockImplementation(async () => {
      active += 1;
      most = Math.max(most, active);
      await Promise.resolve();
      active -= 1;

      return [];
    });

    await Promise.all([log.applyPending(), log.applyPending(), log.poll()]);

    expect(most).toBe(1);
  });
});

describe('SettingsChangeLogService.removeOldEntries', () => {
  function service(writesSettings: boolean) {
    const regional = poolLockDataSource();
    const settings = { query: jest.fn().mockResolvedValue([]) };
    const emitter: Pick<EventEmitter2, 'emitAsync'> = { emitAsync: jest.fn() };
    const log = new SettingsChangeLogService(
      // @ts-expect-error partial mocks: the lock source, the settings `query` and the region
      regional,
      settings,
      { stores: [] },
      emitter,
      { writesSettings }
    );

    return { log, regional, settings };
  }

  it('deletes the old entries on the home pool, once per pool', async () => {
    const { log, regional, settings } = service(true);

    await log.removeOldEntries();

    expect(regional.transaction).toHaveBeenCalledTimes(1);
    expect(settings.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "settings_change_log"'),
      [7]
    );
  });

  it('deletes nothing and takes no lock on another pool', async () => {
    const { log, regional, settings } = service(false);

    await log.removeOldEntries();

    expect(regional.transaction).not.toHaveBeenCalled();
    expect(settings.query).not.toHaveBeenCalled();
  });
});
