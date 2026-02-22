import { applyDecorators, UseGuards } from '@nestjs/common';
import { Permission } from '@app/shared/constants';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from './require-permissions.decorator';

export const Authorize = (...permissions: Permission[]) =>
  applyDecorators(
    UseGuards(JwtAuthGuard, PermissionsGuard),
    RequirePermissions(...permissions)
  );
