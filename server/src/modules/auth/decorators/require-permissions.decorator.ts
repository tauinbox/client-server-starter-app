import { SetMetadata } from '@nestjs/common';
import type { PermissionCheck } from '../casl/app-ability';

export const PERMISSIONS_KEY = 'required_permissions';

/**
 * @internal Attaches metadata only - it does not apply PermissionsGuard, so on
 * its own it looks protective and enforces nothing. Use the Authorize decorator.
 */
export const RequirePermissions = (
  ...checks: [PermissionCheck, ...PermissionCheck[]]
) => SetMetadata(PERMISSIONS_KEY, checks);
