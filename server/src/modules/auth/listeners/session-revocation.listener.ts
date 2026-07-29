import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { UserSessionRevocationRequiredEvent } from '../../users/events/user-session-revocation-required.event';
import { RefreshTokenService } from '../services/refresh-token.service';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class SessionRevocationListener {
  constructor(
    private readonly refreshTokenService: RefreshTokenService,
    private readonly dataSource: DataSource
  ) {}

  // suppressErrors: false is what makes the awaited emit meaningful - the
  // loader swallows and merely logs listener errors by default, so without it
  // emitAsync resolves even when revocation failed.
  @OnEvent(UserSessionRevocationRequiredEvent.name, { suppressErrors: false })
  async handleSessionRevocationRequired(
    event: UserSessionRevocationRequiredEvent
  ): Promise<void> {
    // Both legs are required: the refresh flow never reads tokenRevokedAt, so
    // the stamp alone kills access tokens only, and deleting the refresh rows
    // alone leaves issued access tokens valid until they expire.
    await Promise.all([
      this.refreshTokenService.deleteByUserId(event.userId),
      this.dataSource
        .getRepository(User)
        .update(event.userId, { tokenRevokedAt: new Date() })
    ]);
  }
}
