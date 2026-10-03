import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateFeatureFlagDto } from './create-feature-flag.dto';

// The key is immutable: the percentage bucket hashes it.
// skipNullProperties keeps an explicit null out of the NOT NULL columns the
// update writes through: enabled, environments, public.
export class UpdateFeatureFlagDto extends PartialType(
  OmitType(CreateFeatureFlagDto, ['key'] as const),
  { skipNullProperties: false }
) {}
