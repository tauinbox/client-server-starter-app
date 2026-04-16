import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { UserRoleChangedEvent } from '../events/user-role-changed.event';
import { RefreshTokenService } from '../services/refresh-token.service';
import { PermissionService } from '../services/permission.service';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class UserRoleChangedListener {
  constructor(
    private readonly refreshTokenService: RefreshTokenService,
    private readonly permissionService: PermissionService,
    private readonly dataSource: DataSource
  ) {}

  @OnEvent(UserRoleChangedEvent.name)
  async handleUserRoleChanged(event: UserRoleChangedEvent): Promise<void> {
    await Promise.all([
      this.refreshTokenService.deleteByUserId(event.userId),
      this.dataSource
        .getRepository(User)
        .update(event.userId, { tokenRevokedAt: new Date() }),
      this.permissionService.invalidateUserCache(event.userId)
    ]);
  }
}
