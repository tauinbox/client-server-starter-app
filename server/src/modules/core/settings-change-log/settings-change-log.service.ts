import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import type { Cache } from 'cache-manager';
import { DataSource, EntityManager } from 'typeorm';
import { isSharedCache } from '../../../common/utils/redis-client';
import {
  POOL_LOCK_KEYS,
  runOncePerPool,
  runSerializedInPool
} from '../../../common/utils/pool-lock.util';
import {
  SETTINGS_LOG_LOCK_KEY,
  SETTINGS_TABLES,
  type SettingsApplyScope,
  type SettingsChange,
  type SettingsTable
} from './settings-change.types';
import { SettingsChangedEvent } from './settings-changed.event';

/** The bound of the time a revoke on another pool waits (MR-20). */
export const SETTINGS_POLL_INTERVAL_MS = 5_000;
const APPLY_BATCH = 500;
const RETENTION_DAYS = 7;

interface AppliedState {
  epoch: string;
  version: number;
}

interface LogRow {
  version: string;
  table_name: string;
  operation: string;
  keys: unknown[] | null;
}

const ALL_CHANGED: SettingsChange = {
  all: true,
  tables: new Set(),
  roleIds: [],
  deletedRoleIds: []
};

const SETTINGS_TABLE_SET: ReadonlySet<string> = new Set(SETTINGS_TABLES);

function isSettingsTable(name: string): name is SettingsTable {
  return SETTINGS_TABLE_SET.has(name);
}

export function summarizeSettingsChanges(rows: LogRow[]): SettingsChange {
  const tables = new Set<SettingsTable>();
  const roleIds = new Set<string>();
  const deletedRoleIds = new Set<string>();

  for (const { table_name: table, operation, keys } of rows) {
    // An unknown table or a TRUNCATE names no row: everything is stale.
    if (!isSettingsTable(table) || operation === 'TRUNCATE') {
      return ALL_CHANGED;
    }

    tables.add(table);

    if (table !== 'roles' && table !== 'role_permissions') continue;

    const ids = (keys ?? []).filter((key) => typeof key === 'string');

    for (const id of ids) roleIds.add(id);

    if (table === 'roles' && operation === 'DELETE') {
      for (const id of ids) deletedRoleIds.add(id);
    }
  }

  return {
    all: false,
    tables,
    roleIds: [...roleIds],
    deletedRoleIds: [...deletedRoleIds]
  };
}

/**
 * Takes the log lock at the start of a settings write, before the write locks
 * any row. The trigger takes the same lock before its `nextval`, so the
 * versions commit in their order; taking it first keeps two settings writes
 * from locking rows in opposite orders.
 */
export async function lockSettingsLog(manager: EntityManager): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    SETTINGS_LOG_LOCK_KEY
  ]);
}

/**
 * The one form of a settings write of a service: `write` runs in a transaction
 * that first takes the log lock, and after the commit the change log is applied,
 * so the caller answers only when the caches of its pool no longer hold the old
 * settings. A failed write applies nothing.
 */
export async function writeSettings<T>(
  manager: {
    transaction<R>(run: (em: EntityManager) => Promise<R>): Promise<R>;
  },
  log: Pick<SettingsChangeLogService, 'applyPending'>,
  write: (em: EntityManager) => Promise<T>
): Promise<T> {
  const result = await manager.transaction(async (em) => {
    await lockSettingsLog(em);

    return write(em);
  });

  await log.applyPending();

  return result;
}

/**
 * Applies the settings change log to the caches of this pool. The scope of an
 * apply is the scope of the cache store: with Redis every node of the pool
 * reads the same entries, so one node applies each entry and the applied
 * version is a row of the regional database; with the in-memory store each
 * process applies every entry for itself.
 */
@Injectable()
export class SettingsChangeLogService {
  readonly #logger = new Logger(SettingsChangeLogService.name);
  #processState: AppliedState | null = null;
  #processQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly eventEmitter: EventEmitter2
  ) {}

  /**
   * Called after the commit of a settings write. Waits for the apply lock, so
   * the caller answers only after its own entries are applied; a node that
   * applied them first leaves nothing to do. A lock that stays taken past its
   * wait limit (`POOL_LOCK_WAIT_MS`) fails the call: a silent success would
   * leave a revoked grant live.
   */
  async applyPending(): Promise<void> {
    if (isSharedCache(this.cache)) {
      await runSerializedInPool(
        this.dataSource,
        POOL_LOCK_KEYS.settingsChangeApply,
        (manager) => this.#applyForPool(manager)
      );

      return;
    }

    await this.#applyForProcess();
  }

  /** Picks up the entries of seeders, direct SQL and other pools. */
  @Interval(SETTINGS_POLL_INTERVAL_MS)
  async poll(): Promise<void> {
    try {
      if (isSharedCache(this.cache)) {
        await runOncePerPool(
          this.dataSource,
          POOL_LOCK_KEYS.settingsChangeApply,
          (manager) => this.#applyForPool(manager)
        );
      } else {
        await this.#applyForProcess();
      }
    } catch (error) {
      this.#logger.error('Settings change log apply failed', error);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM, { timeZone: 'UTC' })
  async removeOldEntries(): Promise<void> {
    try {
      await runOncePerPool(
        this.dataSource,
        POOL_LOCK_KEYS.settingsChangeLogCleanup,
        async (manager) => {
          await manager.query(
            `DELETE FROM "settings_change_log" WHERE "created_at" < now() - make_interval(days => $1)`,
            [RETENTION_DAYS]
          );
        }
      );
    } catch (error) {
      this.#logger.error('Settings change log cleanup failed', error);
    }
  }

  async #applyForPool(manager: EntityManager): Promise<void> {
    const rows = await manager.query<Array<{ epoch: string; version: string }>>(
      'SELECT "epoch", "version" FROM "settings_change_applied" WHERE "id" = 1'
    );
    const applied =
      rows.length > 0
        ? { epoch: rows[0].epoch, version: Number(rows[0].version) }
        : null;
    const next = await this.#apply(manager, { applied, scope: 'pool' });

    if (next === applied) return;

    await manager.query(
      `INSERT INTO "settings_change_applied" ("id", "epoch", "version", "applied_at")
       VALUES (1, $1, $2, now())
       ON CONFLICT ("id") DO UPDATE
       SET "epoch" = EXCLUDED."epoch", "version" = EXCLUDED."version", "applied_at" = now()`,
      [next.epoch, next.version]
    );
  }

  /** One apply at a time in this process; the state moves after the commit. */
  #applyForProcess(): Promise<void> {
    const run = this.#processQueue.then(async () => {
      this.#processState = await this.dataSource.transaction((manager) =>
        this.#apply(manager, {
          applied: this.#processState,
          scope: 'process'
        })
      );
    });

    this.#processQueue = run.catch(() => undefined);

    return run;
  }

  /**
   * Applies each entry after `applied` and returns the new state; returns
   * `applied` itself when nothing was new.
   */
  async #apply(
    manager: EntityManager,
    {
      applied,
      scope
    }: { applied: AppliedState | null; scope: SettingsApplyScope }
  ): Promise<AppliedState> {
    const emit = (change: SettingsChange) =>
      this.eventEmitter.emitAsync(
        SettingsChangedEvent.name,
        new SettingsChangedEvent(change, manager, scope)
      );
    const [{ epoch }] = await manager.query<Array<{ epoch: string }>>(
      'SELECT "epoch" FROM "settings_change_epoch" WHERE "id" = 1'
    );
    const [bounds] = await manager.query<
      Array<{ first: string | null; last: string | null }>
    >(
      'SELECT min("version") AS "first", max("version") AS "last" FROM "settings_change_log"'
    );
    const first = bounds.first === null ? null : Number(bounds.first);
    const last = bounds.last === null ? 0 : Number(bounds.last);

    if (
      !applied ||
      applied.epoch !== epoch ||
      applied.version > last ||
      (first !== null && first > applied.version + 1)
    ) {
      await emit(ALL_CHANGED);

      return { epoch, version: last };
    }

    let { version } = applied;

    for (;;) {
      const entries = await manager.query<LogRow[]>(
        `SELECT "version", "table_name", "operation", "keys"
         FROM "settings_change_log" WHERE "version" > $1
         ORDER BY "version" LIMIT $2`,
        [version, APPLY_BATCH]
      );

      if (entries.length === 0) break;

      await emit(summarizeSettingsChanges(entries));
      version = Number(entries.at(-1)?.version ?? version);

      if (entries.length < APPLY_BATCH) break;
    }

    return version === applied.version ? applied : { epoch, version };
  }
}
