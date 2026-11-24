import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RoleRenamedEvent } from '../../auth/events/role-renamed.event';
import { RoleDeletedEvent } from '../../auth/events/role-deleted.event';
import { FeatureFlagService } from '../services/feature-flag.service';

/**
 * Keeps role rules in step with the roles they name, inside the transaction of
 * the role write. `suppressErrors: false` lets a failed rewrite roll that write
 * back and fail the request, instead of leaving a stale rule with no signal.
 * The rewritten rules reach the caches through the settings change log.
 */
@Injectable()
export class RoleRulesListener {
  constructor(private readonly flagService: FeatureFlagService) {}

  @OnEvent(RoleRenamedEvent.name, { suppressErrors: false })
  async handleRoleRenamed(event: RoleRenamedEvent): Promise<void> {
    await this.flagService.rewriteRoleName(
      event.manager,
      event.oldName,
      event.newName
    );
  }

  @OnEvent(RoleDeletedEvent.name, { suppressErrors: false })
  async handleRoleDeleted(event: RoleDeletedEvent): Promise<void> {
    await this.flagService.rewriteRoleName(event.manager, event.name, null);
  }
}
