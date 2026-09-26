import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserSessionRevocationRequiredEvent } from '../../users/events/user-session-revocation-required.event';
import { AuthService } from '../services/auth.service';

@Injectable()
export class SessionRevocationListener {
  constructor(private readonly authService: AuthService) {}

  // suppressErrors: false is what makes the awaited emit meaningful - the
  // loader swallows and merely logs listener errors by default, so without it
  // emitAsync resolves even when revocation failed.
  @OnEvent(UserSessionRevocationRequiredEvent.name, { suppressErrors: false })
  async handleSessionRevocationRequired(
    event: UserSessionRevocationRequiredEvent
  ): Promise<void> {
    await this.authService.revokeAllUserSessions(event.userId);
  }
}
