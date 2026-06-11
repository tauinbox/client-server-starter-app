import type { CustomerGrant } from './customer-grant.entity';
import type { CustomerGrantResponse, _AssertNever } from '@app/shared/types';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof CustomerGrant, keyof CustomerGrantResponse>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof CustomerGrantResponse, keyof CustomerGrant>
>;
