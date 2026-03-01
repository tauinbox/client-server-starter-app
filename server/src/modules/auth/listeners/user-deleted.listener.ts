import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { UserDeletedEvent } from '../../users/events/user-deleted.event';
import { RefreshTokenService } from '../services/refresh-token.service';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class UserDeletedListener {
  constructor(
    private readonly refreshTokenService: RefreshTokenService,
    private readonly dataSource: DataSource
  ) {}

  @OnEvent(UserDeletedEvent.name)
  async handle(event: UserDeletedEvent): Promise<void> {
    await Promise.all([
      this.refreshTokenService.deleteByUserId(event.userId),
      this.dataSource
        .getRepository(User)
        .update(event.userId, { tokenRevokedAt: new Date() })
    ]);
  }
}
