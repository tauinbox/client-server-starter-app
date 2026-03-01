/**
 * Compile-time contract for the Role entity.
 * See user.entity-contract.ts for the full explanation of this pattern.
 *
 * When you add a field to Role:
 *   - Public field → add it to RoleResponse in shared/src/types/role.types.ts.
 *   - Sensitive field → add @Exclude() and list it in _ExcludedFields.
 *   - Navigation property → list it in _NavigationFields with a comment.
 */

import type { Role } from './role.entity';
import type { RoleResponse, _AssertNever } from '@app/shared/types';

/**
 * TypeORM navigation / relation properties — not serialised in list responses
 * because TypeORM does not eager-load them unless explicitly requested.
 *   rolePermissions: RolePermission[]  →  loaded on demand, not in RoleResponse
 *   users: User[]                      →  loaded on demand, not in RoleResponse
 */
type _NavigationFields = 'rolePermissions' | 'users';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof Role, keyof RoleResponse | _NavigationFields>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof RoleResponse, keyof Role>
>;
