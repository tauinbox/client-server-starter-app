import type { EntityManager } from 'typeorm';
import type {
  SettingsApplyScope,
  SettingsChange,
  SettingsTable
} from '../settings-change.types';
import { SettingsChangedEvent } from '../settings-changed.event';

/**
 * A `SettingsChangedEvent` for a listener spec; nothing changed by default,
 * applied in the pool scope.
 */
export function settingsChangedEvent(
  change: {
    all?: boolean;
    tables?: SettingsTable[];
    roleIds?: string[];
    deletedRoleIds?: string[];
  } = {},
  {
    manager = {} as EntityManager,
    scope = 'pool'
  }: { manager?: EntityManager; scope?: SettingsApplyScope } = {}
): SettingsChangedEvent {
  const full: SettingsChange = {
    all: change.all ?? false,
    tables: new Set(change.tables ?? []),
    roleIds: change.roleIds ?? [],
    deletedRoleIds: change.deletedRoleIds ?? []
  };

  return new SettingsChangedEvent(full, manager, scope);
}
