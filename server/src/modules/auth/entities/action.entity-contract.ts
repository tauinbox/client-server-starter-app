/**
 * Compile-time contract for the Action entity.
 * See user.entity-contract.ts for the full explanation of this pattern.
 */

import type { Action } from './action.entity';
import type { ActionResponse, _AssertNever } from '@app/shared/types';

/**
 * TypeORM navigation properties.
 *   permissions: Permission[]  →  loaded on demand, not in ActionResponse
 */
type _NavigationFields = 'permissions';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof Action, keyof ActionResponse | _NavigationFields>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof ActionResponse, keyof Action>
>;
