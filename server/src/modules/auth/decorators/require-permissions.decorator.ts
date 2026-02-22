import { SetMetadata } from '@nestjs/common';
import type { PermissionCheck } from '../casl/app-ability';

export const PERMISSIONS_KEY = 'required_permissions';
export const RequirePermissions = (...checks: PermissionCheck[]) =>
  SetMetadata(PERMISSIONS_KEY, checks);
