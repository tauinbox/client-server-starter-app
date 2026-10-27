import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserRoleChangedEvent } from '../events/user-role-changed.event';
import { AuthService } from '../services/auth.service';

@Injectable()
export class UserRoleChangedListener {
  constructor(private readonly authService: AuthService) {}

  // suppressErrors: false is what makes the awaited emit in the controller
  // meaningful - the loader swallows and merely logs listener errors by
  // default, so without it emitAsync resolves even when revocation failed and
  // the caller still gets a 200.
  @OnEvent(UserRoleChangedEvent.name, { suppressErrors: false })
  async handleUserRoleChanged(event: UserRoleChangedEvent): Promise<void> {
    await this.authService.revokeAllUserSessions(event.userId);
  }
}
