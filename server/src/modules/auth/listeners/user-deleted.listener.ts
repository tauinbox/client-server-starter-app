import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { UserDeletedEvent } from '../../users/events/user-deleted.event';
import { UserPasswordChangedByAdminEvent } from '../../users/events/user-password-changed-by-admin.event';
import { RefreshTokenService } from '../services/refresh-token.service';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class UserDeletedListener {
  constructor(
    private readonly refreshTokenService: RefreshTokenService,
    private readonly dataSource: DataSource
  ) {}

  @OnEvent(UserDeletedEvent.name)
  async handleUserDeleted(event: UserDeletedEvent): Promise<void> {
    await Promise.all([
      this.invalidateSessions(event.userId),
      // Defence in depth: UsersService.remove clears these too, but the
      // listener covers any other deletion entrypoint that may be added later.
      this.dataSource.getRepository(User).update(event.userId, {
        pendingEmail: null,
        pendingEmailToken: null,
        pendingEmailExpiresAt: null
      })
    ]);
  }

  @OnEvent(UserPasswordChangedByAdminEvent.name)
  async handlePasswordChangedByAdmin(
    event: UserPasswordChangedByAdminEvent
  ): Promise<void> {
    await this.invalidateSessions(event.userId);
  }

  private async invalidateSessions(userId: string): Promise<void> {
    await Promise.all([
      this.refreshTokenService.deleteByUserId(userId),
      this.dataSource
        .getRepository(User)
        .update(userId, { tokenRevokedAt: new Date() })
    ]);
  }
}
