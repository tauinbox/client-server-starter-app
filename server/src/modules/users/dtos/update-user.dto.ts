import {
  ApiPropertyOptional,
  IntersectionType,
  PartialType
} from '@nestjs/swagger';
import { IsBoolean, ValidateIf } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { StepUpFactorsDto } from '../../auth/dtos/step-up-factors.dto';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';

// skipNullProperties rejects an explicit null, which would otherwise reach a
// NOT NULL column or wipe the password. The step-up factors are the CALLER's.
export class UpdateUserDto extends IntersectionType(
  PartialType(CreateUserDto, { skipNullProperties: false }),
  StepUpFactorsDto
) {
  @ApiPropertyOptional({
    description: 'Whether the user is active',
    example: true
  })
  @ValidateIf(propertyIsDefined)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Set to true to unlock a locked account',
    example: true
  })
  @ValidateIf(propertyIsDefined)
  @IsBoolean()
  unlockAccount?: boolean;
}
