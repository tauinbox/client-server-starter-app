import type { EntityManager } from 'typeorm';
import type { SettingsChange, SettingsTable } from '../settings-change.types';
import { SettingsChangedEvent } from '../settings-changed.event';

/** A `SettingsChangedEvent` for a listener spec; nothing changed by default. */
export function settingsChangedEvent(
  change: {
    all?: boolean;
    tables?: SettingsTable[];
    roleIds?: string[];
    deletedRoleIds?: string[];
  } = {},
  manager: EntityManager = {} as EntityManager
): SettingsChangedEvent {
  const full: SettingsChange = {
    all: change.all ?? false,
    tables: new Set(change.tables ?? []),
    roleIds: change.roleIds ?? [],
    deletedRoleIds: change.deletedRoleIds ?? []
  };

  return new SettingsChangedEvent(full, manager);
}
