import type { RegionRegistryEntry } from './region-registry-entry.entity';
import type { RegionStatusResponse, _AssertNever } from '@app/shared/types';

/** `updatedAt` has `@Exclude()`: the wire type carries only the status. */
type _ExcludedFields = 'updatedAt';

type _EntityFieldCoverage = _AssertNever<
  Exclude<
    keyof RegionRegistryEntry,
    keyof RegionStatusResponse | _ExcludedFields
  >
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof RegionStatusResponse, keyof RegionRegistryEntry>
>;
