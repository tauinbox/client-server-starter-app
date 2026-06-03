import type { UsageRecord } from './usage-record.entity';
import type { UsageResponse, _AssertNever } from '@app/shared/types';

/** Internal write-dedup key, @Exclude()-d from the wire format. */
type _ExcludedFields = 'idempotencyKey';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof UsageRecord, keyof UsageResponse | _ExcludedFields>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof UsageResponse, keyof UsageRecord>
>;
