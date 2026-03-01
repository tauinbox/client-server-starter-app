/**
 * Compile-time contract for the Permission entity.
 * See user.entity-contract.ts for the full explanation of this pattern.
 */

import type { Permission } from './permission.entity';
import type { PermissionResponse, _AssertNever } from '@app/shared/types';

/**
 * TypeORM navigation property — not serialised in list responses.
 *   rolePermissions: RolePermission[]  →  loaded on demand, not in PermissionResponse
 */
type _NavigationFields = 'rolePermissions';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof Permission, keyof PermissionResponse | _NavigationFields>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof PermissionResponse, keyof Permission>
>;
