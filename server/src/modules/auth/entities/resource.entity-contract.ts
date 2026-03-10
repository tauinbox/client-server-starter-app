/**
 * Compile-time contract for the Resource entity.
 * See user.entity-contract.ts for the full explanation of this pattern.
 */

import type { Resource } from './resource.entity';
import type { ResourceResponse, _AssertNever } from '@app/shared/types';

/**
 * TypeORM navigation / internal fields.
 *   permissions: Permission[]  →  loaded on demand, not in ResourceResponse
 *   lastSyncedAt: Date | null  →  internal, not exposed in API responses
 */
type _NavigationFields = 'permissions' | 'lastSyncedAt';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof Resource, keyof ResourceResponse | _NavigationFields>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof ResourceResponse, keyof Resource>
>;
