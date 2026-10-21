import type { AuditContext } from '../../audit/audit.service';
import {
  SYSTEM_ABILITY,
  type AbilityOrSystem,
  type AppAbility
} from './app-ability';

/**
 * The request context travels with the ability: PermissionsGuard builds a new
 * ability for each request and binds the context to it, so an instance check
 * deep in a service audits the ip and the request id without one more
 * parameter on every service method.
 */
const contexts = new WeakMap<AppAbility, AuditContext>();

export function bindAuditContext(
  ability: AppAbility,
  context: AuditContext
): void {
  contexts.set(ability, context);
}

export function auditContextOf(
  ability: AbilityOrSystem
): AuditContext | undefined {
  return ability === SYSTEM_ABILITY ? undefined : contexts.get(ability);
}
