import type { Plan } from './plan.entity';
import type { PlanResponse, _AssertNever } from '@app/shared/types';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof Plan, keyof PlanResponse>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof PlanResponse, keyof Plan>
>;
