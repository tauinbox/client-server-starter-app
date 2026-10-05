import type { FlagAuditActor } from '../src/modules/feature-flags/services/feature-flag.service';

export function flagAuditActor(actorId: string | null = null): FlagAuditActor {
  return { actorId, actorEmail: null, context: {} };
}
