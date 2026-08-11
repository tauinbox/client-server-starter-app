import { IsIn, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { CancelMode } from '../providers/payment-provider.interface';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';

export class CancelSubscriptionRequestDto {
  @ApiPropertyOptional({
    description:
      'When the cancellation takes effect. Defaults to the end of the current paid period.',
    enum: ['period_end', 'immediate'],
    default: 'period_end'
  })
  // Defined-only, not @IsOptional(): the user-facing route forwards the value
  // into a default parameter, which only fills in for an omitted property, so
  // an explicit null would reach the provider adapter as a CancelMode.
  @ValidateIf(propertyIsDefined)
  @IsIn(['period_end', 'immediate'])
  mode?: CancelMode;
}
