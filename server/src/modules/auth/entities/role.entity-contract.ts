/**
 * Compile-time contract for the Role entity.
 * See user.entity-contract.ts for the full explanation of this pattern.
 *
 * Coverage is checked against RoleAdminResponse (the superset that includes
 * isSystem/isSuper, gated by @Expose({ groups: ['privileged'] }) and surfaced only
 * on endpoints with @SerializeOptions({ groups: ['privileged'] })). The public
 * RoleResponse drops those fields at the wire layer; entity coverage still has
 * to account for them.
 *
 * When you add a field to Role:
 *   - Privileged-only field → add it to RoleAdminResponse and decorate with
 *     @Expose({ groups: ['privileged'] }).
 *   - Public field → add it to RoleResponse (inherited by RoleAdminResponse).
 *   - Sensitive field → add @Exclude() and list it in _ExcludedFields.
 *   - Navigation property → list it in _NavigationFields with a comment.
 */

import type { Role } from './role.entity';
import type { RoleAdminResponse, _AssertNever } from '@app/shared/types';

/**
 * TypeORM navigation / relation properties — not serialised in list responses
 * because TypeORM does not eager-load them unless explicitly requested.
 *   rolePermissions: RolePermission[]  →  loaded on demand, not in RoleAdminResponse
 *   users: User[]                      →  loaded on demand, not in RoleAdminResponse
 */
type _NavigationFields = 'rolePermissions' | 'users';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof Role, keyof RoleAdminResponse | _NavigationFields>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof RoleAdminResponse, keyof Role>
>;
