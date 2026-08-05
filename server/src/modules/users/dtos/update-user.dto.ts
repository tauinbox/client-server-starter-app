import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, ValidateIf } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';

// @nestjs/swagger's PartialType (not @nestjs/mapped-types') keeps the inherited
// @ApiProperty metadata; skipNullProperties rejects an explicit null, which
// would otherwise reach a NOT NULL column or wipe the password.
export class UpdateUserDto extends PartialType(CreateUserDto, {
  skipNullProperties: false
}) {
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
