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
 *   isRegistered?: boolean     →  virtual field set by ResourceService at runtime; optional in entity,
 *                                  required in ResourceResponse (populated before every response)
 */
type _NavigationFields = 'permissions' | 'lastSyncedAt' | 'isRegistered';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof Resource, keyof ResourceResponse | _NavigationFields>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof ResourceResponse, keyof Resource>
>;
