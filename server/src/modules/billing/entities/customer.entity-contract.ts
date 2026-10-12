import type { Customer } from './customer.entity';
import type { CustomerResponse, _AssertNever } from '@app/shared/types';

/** Internal fields, @Exclude()-d from the wire format. */
type _ExcludedFields = 'providerCustomerId' | 'trialUsedAt';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof Customer, keyof CustomerResponse | _ExcludedFields>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof CustomerResponse, keyof Customer>
>;
