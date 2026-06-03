import type { PaymentMethod } from './payment-method.entity';
import type { PaymentMethodResponse, _AssertNever } from '@app/shared/types';

/** Provider tokenised method reference, @Exclude()-d from the wire format. */
type _ExcludedFields = 'providerMethodRef';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof PaymentMethod, keyof PaymentMethodResponse | _ExcludedFields>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof PaymentMethodResponse, keyof PaymentMethod>
>;
