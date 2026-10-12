import { IsIn, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CANCEL_MODES } from '@app/shared/constants';
import type { CancelMode } from '@app/shared/types';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';

export class CancelSubscriptionRequestDto {
  @ApiPropertyOptional({
    description:
      'When the cancellation takes effect. Defaults to the end of the current paid period.',
    enum: CANCEL_MODES,
    default: 'period_end'
  })
  // Defined-only, not @IsOptional(): the user-facing route forwards the value
  // into a default parameter, which only fills in for an omitted property, so
  // an explicit null would reach the provider adapter as a CancelMode.
  @ValidateIf(propertyIsDefined)
  @IsIn(CANCEL_MODES)
  mode?: CancelMode;
}
