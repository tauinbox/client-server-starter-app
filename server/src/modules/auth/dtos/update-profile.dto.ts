import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf
} from 'class-validator';
import {
  PASSWORD_REGEX,
  PASSWORD_ERROR
} from '@app/shared/constants/password.constants';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'The first name of the user',
    example: 'John'
  })
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(255)
  firstName?: string;

  @ApiPropertyOptional({
    description: 'The last name of the user',
    example: 'Doe'
  })
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(255)
  lastName?: string;

  @ApiPropertyOptional({
    description:
      'New password (min 8 characters, must contain uppercase, lowercase and number)',
    example: 'NewPassword123',
    minLength: 8
  })
  @IsOptional()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_REGEX, { message: PASSWORD_ERROR })
  password?: string;

  @ApiPropertyOptional({
    description:
      'Current password — required when changing the password. ' +
      'OAuth-only users (no password set) may omit this field when setting their first password.',
    example: 'CurrentPassword123'
  })
  @ValidateIf((o: UpdateProfileDto) => o.password !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword?: string;
}
