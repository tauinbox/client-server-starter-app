import { applyDecorators, UseGuards } from '@nestjs/common';
import type { PermissionCheck } from '../casl/app-ability';
import { MfaRequiredGuard } from '../guards/mfa-required.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from './require-permissions.decorator';

/**
 * At least one check is required by the type: PermissionsGuard passes an empty
 * metadata array, and because it reads metadata with `getAllAndOverride`, a
 * handler-level empty call would also cancel a class-level `@Authorize(...)`.
 *
 * MfaRequiredGuard comes first so that the set of routes which demand a second
 * factor from a super role is exactly the set this decorator protects.
 */
export const Authorize = (...checks: [PermissionCheck, ...PermissionCheck[]]) =>
  applyDecorators(
    UseGuards(MfaRequiredGuard, PermissionsGuard),
    RequirePermissions(...checks)
  );
