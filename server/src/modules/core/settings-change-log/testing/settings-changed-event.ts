import type { EntityManager } from 'typeorm';
import type { SourceManagers } from '../../../../data-sources';
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
    managers = {
      regional: {} as EntityManager,
      settings: {} as EntityManager
    },
    scope = 'pool'
  }: { managers?: SourceManagers; scope?: SettingsApplyScope } = {}
): SettingsChangedEvent {
  const full: SettingsChange = {
    all: change.all ?? false,
    tables: new Set(change.tables ?? []),
    roleIds: change.roleIds ?? [],
    deletedRoleIds: change.deletedRoleIds ?? []
  };

  return new SettingsChangedEvent(full, managers, scope);
}
