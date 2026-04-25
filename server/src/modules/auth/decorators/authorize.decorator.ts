import { applyDecorators, UseGuards } from '@nestjs/common';
import type { PermissionCheck } from '../casl/app-ability';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from './require-permissions.decorator';

export const Authorize = (...checks: PermissionCheck[]) =>
  applyDecorators(UseGuards(PermissionsGuard), RequirePermissions(...checks));
