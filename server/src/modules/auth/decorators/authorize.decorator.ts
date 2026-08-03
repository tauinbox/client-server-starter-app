import { applyDecorators, UseGuards } from '@nestjs/common';
import type { PermissionCheck } from '../casl/app-ability';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from './require-permissions.decorator';

/**
 * At least one check is required by the type: PermissionsGuard passes an empty
 * metadata array, and because it reads metadata with `getAllAndOverride`, a
 * handler-level empty call would also cancel a class-level `@Authorize(...)`.
 */
export const Authorize = (...checks: [PermissionCheck, ...PermissionCheck[]]) =>
  applyDecorators(UseGuards(PermissionsGuard), RequirePermissions(...checks));
