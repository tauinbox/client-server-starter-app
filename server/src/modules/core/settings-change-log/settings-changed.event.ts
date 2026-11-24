import type { EntityManager } from 'typeorm';
import type {
  SettingsApplyScope,
  SettingsChange
} from './settings-change.types';

/**
 * Emitted once for each applied batch of the settings change log, inside the
 * transaction that holds the apply lock. A listener uses `manager` for its
 * reads and writes, so the apply needs no second connection, and registers
 * with `suppressErrors: false`, so a failure leaves the applied version where
 * it was and the next apply repeats the batch. A push to the SSE clients does
 * not wait: a repeat sends it again, which the client absorbs.
 */
export class SettingsChangedEvent {
  constructor(
    readonly change: SettingsChange,
    readonly manager: EntityManager,
    readonly scope: SettingsApplyScope
  ) {}
}
