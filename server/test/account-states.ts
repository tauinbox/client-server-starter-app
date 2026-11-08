import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MAX_FAILED_ATTEMPTS } from '@app/shared/constants';
import {
  AccountState,
  untilNextSecond
} from '@app/shared/utils/request-scenarios';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { User } from '../src/modules/users/entities/user.entity';

/** Puts an account into each state of the sign-in state matrix. */
export const ACCOUNT_STATE_SETUP: Record<
  AccountState,
  (app: INestApplication, userId: string) => Promise<unknown>
> = {
  'deactivated-actor': (app, userId) =>
    users(app).update(userId, { isActive: false }),
  'deleted-actor': (app, userId) => users(app).softDelete(userId),
  // A token keeps its issue time in whole seconds.
  'revoked-actor': async (app, userId) => {
    await untilNextSecond();
    await app.get(AuthService).revokeAllUserSessions(userId);
  },
  'locked-actor': (app, userId) =>
    users(app).update(userId, {
      failedLoginAttempts: MAX_FAILED_ATTEMPTS,
      lockedUntil: new Date(Date.now() + 3600_000)
    }),
  'unverified-actor': (app, userId) =>
    users(app).update(userId, { isEmailVerified: false }),
  'passwordless-actor': (app, userId) =>
    users(app).update(userId, { password: null })
};

function users(app: INestApplication) {
  return app.get(DataSource).getRepository(User);
}
