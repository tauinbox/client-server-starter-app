/**
 * The tables of the settings set. Each one has the two log triggers of the
 * migration `add-settings-change-log`; `settings-change-log.e2e-spec.ts` fails
 * when the triggers of the schema and this list differ.
 */
export const SETTINGS_TABLES = [
  'roles',
  'role_permissions',
  'permissions',
  'resources',
  'actions',
  'feature_flags',
  'feature_flag_rules',
  'plans',
  'billing_products'
] as const;

export type SettingsTable = (typeof SETTINGS_TABLES)[number];

/** The key of the log lock that orders the versions; the trigger uses it too. */
export const SETTINGS_LOG_LOCK_KEY = 'nexus:settings-change-log';

/**
 * Who applies a log entry: one node for the pool (the cache is in Redis), or
 * each process for itself (the memory cache). A write that only one applier may
 * do, such as the delete of the membership rows of a deleted role, runs only in
 * the pool scope: in the process scope another process still reads those rows
 * as the holders whose caches it drops.
 */
export type SettingsApplyScope = 'pool' | 'process';

/** What a batch of log entries changed. */
export interface SettingsChange {
  /**
   * Every settings cache is stale: the first apply of a pool, another epoch
   * (a restore of the settings), entries lost to the retention, or a TRUNCATE.
   */
  all: boolean;
  tables: ReadonlySet<SettingsTable>;
  /** Roles whose row or grants changed. Their holders have stale abilities. */
  roleIds: readonly string[];
  /** Roles that were deleted. Their membership rows go after the apply. */
  deletedRoleIds: readonly string[];
}

export function touches(
  change: SettingsChange,
  ...tables: SettingsTable[]
): boolean {
  return change.all || tables.some((table) => change.tables.has(table));
}
