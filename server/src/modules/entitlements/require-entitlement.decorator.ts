import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { EntitlementGuard } from './entitlement.guard';
import type { EntitlementCapability } from './entitlement.types';

export const ENTITLEMENT_KEY = 'entitlement_capability';

/**
 * Gates a route behind a billing capability. Returns 403 when the
 * caller's plan does not grant it. Authorization is separate — combine with
 * `@Authorize` for permissions.
 */
export const RequireEntitlement = (capability: EntitlementCapability) =>
  applyDecorators(
    SetMetadata(ENTITLEMENT_KEY, capability),
    UseGuards(EntitlementGuard)
  );
