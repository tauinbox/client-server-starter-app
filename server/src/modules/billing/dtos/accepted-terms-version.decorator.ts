import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MaxLength, ValidateIf } from 'class-validator';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';

/**
 * The version of the terms that the buyer accepted. The service refuses a
 * missing or stale version while the terms of the jurisdiction are published.
 */
export function AcceptedTermsVersion(): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({
      description:
        'The version of the terms that the buyer accepted (`termsVersion` of GET /billing/region). Required while the terms of the jurisdiction are published.',
      example: '2026-11-14'
    }),
    // applyDecorators registers in list order, the reverse of a decorator
    // stack: this order reports as `@IsString() @MaxLength(32)` does.
    MaxLength(32),
    IsString(),
    ValidateIf(propertyIsDefined)
  );
}
