/**
 * Requests that every session of `userId` be revoked. Deliberately separate
 * from `UserDeletedEvent`, which accompanies a user delete: its consumers
 * (notifications, billing cleanup) are best-effort and must never fail the
 * request. This one is
 * emitted with `emitAsync` and awaited, so its single handler's failure
 * surfaces to the caller instead of leaving the target's tokens alive behind
 * a 200.
 */
export class UserSessionRevocationRequiredEvent {
  constructor(public readonly userId: string) {}
}
