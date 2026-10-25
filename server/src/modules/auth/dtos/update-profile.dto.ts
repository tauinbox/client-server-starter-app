import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  MaxLength,
  MinLength,
  ValidateIf
} from 'class-validator';
import {
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  SUPPORTED_LOCALES
} from '@app/shared/constants';
import { Transform } from 'class-transformer';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';
import { StepUpFactorsDto } from './step-up-factors.dto';

/** The step-up factors are read only when the body sets a password. */
export class UpdateProfileDto extends StepUpFactorsDto {
  @ApiPropertyOptional({
    description: 'The full name of the user, in the order the user writes it',
    example: 'John Doe'
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value
  )
  @ValidateIf(propertyIsDefined)
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    description:
      'New password. Rejected when it appears in a public breach corpus.',
    example: 'Sunrise-Kettle-19',
    minLength: MIN_PASSWORD_LENGTH
  })
  @ValidateIf(propertyIsDefined)
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(MAX_PASSWORD_LENGTH)
  password?: string;

  @ApiPropertyOptional({
    description: 'Preferred locale for transactional emails',
    enum: SUPPORTED_LOCALES,
    example: 'en'
  })
  @ValidateIf(propertyIsDefined)
  @IsIn([...SUPPORTED_LOCALES])
  locale?: string;
}
