/**
 * Requests that every session of `userId` be revoked. Deliberately separate
 * from the broadcast events that accompany the same admin actions
 * (`UserDeletedEvent`, `UserPasswordChangedByAdminEvent`): those are consumed
 * by notifications, feature-flag cache invalidation and billing cleanup, all
 * of which are best-effort and must never fail the request. This one is
 * emitted with `emitAsync` and awaited, so its single handler's failure
 * surfaces to the caller instead of leaving the target's tokens alive behind
 * a 200.
 */
export class UserSessionRevocationRequiredEvent {
  constructor(public readonly userId: string) {}
}
