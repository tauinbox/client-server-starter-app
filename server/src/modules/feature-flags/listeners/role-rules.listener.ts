import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { RoleRenamedEvent } from '../../auth/events/role-renamed.event';
import { RoleDeletedEvent } from '../../auth/events/role-deleted.event';
import { FeatureFlagChangedEvent } from '../events/feature-flag-changed.event';
import { FeatureFlagService } from '../services/feature-flag.service';

/**
 * Keeps role rules in step with the roles they name. `suppressErrors: false`
 * lets a failed rewrite reach the admin who renamed or deleted the role,
 * instead of leaving a stale rule with no signal.
 */
@Injectable()
export class RoleRulesListener {
  constructor(
    private readonly flagService: FeatureFlagService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  @OnEvent(RoleRenamedEvent.name, { suppressErrors: false })
  async handleRoleRenamed(event: RoleRenamedEvent): Promise<void> {
    this.#announce(
      await this.flagService.rewriteRoleName(event.oldName, event.newName)
    );
  }

  @OnEvent(RoleDeletedEvent.name, { suppressErrors: false })
  async handleRoleDeleted(event: RoleDeletedEvent): Promise<void> {
    this.#announce(await this.flagService.rewriteRoleName(event.name, null));
  }

  #announce(flagKeys: string[]): void {
    for (const key of flagKeys) {
      this.eventEmitter.emit(
        FeatureFlagChangedEvent.name,
        new FeatureFlagChangedEvent(key, 'rules-replaced')
      );
    }
  }
}
