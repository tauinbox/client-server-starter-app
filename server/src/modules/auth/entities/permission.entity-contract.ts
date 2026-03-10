/**
 * Compile-time contract for the Permission entity.
 * See user.entity-contract.ts for the full explanation of this pattern.
 *
 * The Permission entity uses eager-loaded ManyToOne relations for resource and action.
 * PermissionResponse includes nested ResourceResponse and ActionResponse objects.
 * The FK columns resourceId/actionId are internal — not exposed in the response.
 */

import type { Permission } from './permission.entity';
import type { PermissionResponse, _AssertNever } from '@app/shared/types';

/**
 * TypeORM navigation / internal fields — not serialised directly in responses.
 *   rolePermissions: RolePermission[]  →  loaded on demand, not in PermissionResponse
 *   resourceId: string                 →  FK column, resource object is used instead
 *   actionId: string                   →  FK column, action object is used instead
 */
type _NavigationFields = 'rolePermissions' | 'resourceId' | 'actionId';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof Permission, keyof PermissionResponse | _NavigationFields>
>;

// PermissionResponse.resource is ResourceResponse (not Resource entity),
// PermissionResponse.action is ActionResponse (not Action entity).
// The structural shapes match at runtime via TypeORM serialization.
