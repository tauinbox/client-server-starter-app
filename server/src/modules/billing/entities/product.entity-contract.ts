import type { Product } from './product.entity';
import type { ProductResponse, _AssertNever } from '@app/shared/types';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof Product, keyof ProductResponse>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof ProductResponse, keyof Product>
>;
