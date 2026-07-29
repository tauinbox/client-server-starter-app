import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { UserDeletedEvent } from '../../users/events/user-deleted.event';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class UserDeletedListener {
  constructor(private readonly dataSource: DataSource) {}

  @OnEvent(UserDeletedEvent.name)
  async handleUserDeleted(event: UserDeletedEvent): Promise<void> {
    // Defence in depth: UsersService.remove clears these too, but the
    // listener covers any other deletion entrypoint that may be added later.
    // Session revocation is NOT done here - it is awaited by the caller via
    // UserSessionRevocationRequiredEvent.
    await this.dataSource.getRepository(User).update(event.userId, {
      pendingEmail: null,
      pendingEmailToken: null,
      pendingEmailExpiresAt: null
    });
  }
}
