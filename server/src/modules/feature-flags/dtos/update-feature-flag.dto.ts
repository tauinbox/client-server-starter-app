import { PartialType } from '@nestjs/swagger';
import { CreateFeatureFlagDto } from './create-feature-flag.dto';

// skipNullProperties keeps an explicit null out of the NOT NULL columns the
// update writes through: key, enabled, environments, public.
export class UpdateFeatureFlagDto extends PartialType(CreateFeatureFlagDto, {
  skipNullProperties: false
}) {}
