import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { In } from 'typeorm';
import { SettingsChangedEvent } from '../../core/settings-change-log/settings-changed.event';
import { touches } from '../../core/settings-change-log/settings-change.types';
import { UserRole } from '../../users/entities/user-role.entity';
import { RolePermissionsChangedEvent } from '../events/role-permissions-changed.event';
import { PermissionService } from '../services/permission.service';
import { ResourceService } from '../services/resource.service';

/**
 * Applies a settings change to the RBAC caches of this pool: the subject map,
 * the lists of each holder of a changed role, and the membership rows of a
 * deleted role. The holders are read before those rows go.
 */
@Injectable()
export class RbacSettingsChangedListener {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly resourceService: ResourceService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  @OnEvent(SettingsChangedEvent.name, { suppressErrors: false })
  async handleSettingsChanged({
    change,
    manager
  }: SettingsChangedEvent): Promise<void> {
    if (touches(change, 'resources', 'permissions', 'actions')) {
      await this.resourceService.invalidateSubjectMapCache();
    }

    if (change.all) {
      await this.permissionService.invalidateAll();
      // A role deleted before a rebase left its membership rows.
      await manager.query(
        `DELETE FROM "user_roles" ur WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."id" = ur."role_id")`
      );

      return;
    }

    const holderIds = await this.permissionService.findHolderIds(
      manager,
      change.roleIds
    );

    if (change.deletedRoleIds.length > 0) {
      await manager.delete(UserRole, {
        roleId: In([...change.deletedRoleIds])
      });
    }

    await Promise.all(
      holderIds.map((id) => this.permissionService.invalidateUserCache(id))
    );

    // Not UserRoleChangedEvent: that one also revokes the sessions.
    if (holderIds.length > 0) {
      this.eventEmitter.emit(
        RolePermissionsChangedEvent.name,
        new RolePermissionsChangedEvent(holderIds)
      );
    }
  }
}
