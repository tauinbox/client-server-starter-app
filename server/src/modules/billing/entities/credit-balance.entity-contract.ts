import type { CreditBalance } from './credit-balance.entity';
import type { CreditBalanceResponse, _AssertNever } from '@app/shared/types';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof CreditBalance, keyof CreditBalanceResponse>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof CreditBalanceResponse, keyof CreditBalance>
>;
