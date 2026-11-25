import type { SourceManagers } from '../../../data-sources';
import type {
  SettingsApplyScope,
  SettingsChange
} from './settings-change.types';

/**
 * Emitted once for each applied batch of the settings change log. A listener
 * reads and writes the regional rows with `managers.regional`, the transaction
 * that holds the apply lock, so the apply needs no second regional connection;
 * it reads the settings rows with `managers.settings`. It registers with
 * `suppressErrors: false`, so a failure leaves the applied version where it
 * was and the next apply repeats the batch. A push to the SSE clients does not
 * wait: a repeat sends it again, which the client absorbs.
 */
export class SettingsChangedEvent {
  constructor(
    readonly change: SettingsChange,
    readonly managers: SourceManagers,
    readonly scope: SettingsApplyScope
  ) {}
}
