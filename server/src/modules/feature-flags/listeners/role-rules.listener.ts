import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { RoleRenamedEvent } from '../../auth/events/role-renamed.event';
import { RoleDeletedEvent } from '../../auth/events/role-deleted.event';
import { FeatureFlagChangedEvent } from '../events/feature-flag-changed.event';
import { FeatureFlagService } from '../services/feature-flag.service';

/**
 * Keeps role rules in step with the roles they name, inside the transaction of
 * the role write. `suppressErrors: false` lets a failed rewrite roll that write
 * back and fail the request, instead of leaving a stale rule with no signal.
 */
@Injectable()
export class RoleRulesListener {
  constructor(
    private readonly flagService: FeatureFlagService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  @OnEvent(RoleRenamedEvent.name, { suppressErrors: false })
  async handleRoleRenamed(event: RoleRenamedEvent): Promise<void> {
    const keys = await this.flagService.rewriteRoleName(
      event.manager,
      event.oldName,
      event.newName
    );
    this.#announceAfter(event.committed, keys);
  }

  @OnEvent(RoleDeletedEvent.name, { suppressErrors: false })
  async handleRoleDeleted(event: RoleDeletedEvent): Promise<void> {
    const keys = await this.flagService.rewriteRoleName(
      event.manager,
      event.name,
      null
    );
    this.#announceAfter(event.committed, keys);
  }

  // A cache reset before the commit lets a concurrent read cache the old rules
  // again, so the flags are announced only after it.
  #announceAfter(committed: Promise<void>, changedKeys: string[]): void {
    if (changedKeys.length === 0) return;
    void committed.then(() => {
      this.eventEmitter.emit(
        FeatureFlagChangedEvent.name,
        new FeatureFlagChangedEvent()
      );
    });
  }
}
