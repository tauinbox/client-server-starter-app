import {
  IsEmail,
  IsNotEmpty,
  Matches,
  MaxLength,
  MinLength
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  PASSWORD_REGEX,
  PASSWORD_ERROR
} from '@app/shared/constants/password.constants';

export class CreateUserDto {
  @ApiProperty({
    description: 'The email of the user',
    example: 'user@example.com'
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value
  )
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({
    description: 'The first name of the user',
    example: 'John'
  })
  @IsNotEmpty()
  @MaxLength(255)
  firstName: string;

  @ApiProperty({
    description: 'The last name of the user',
    example: 'Doe'
  })
  @IsNotEmpty()
  @MaxLength(255)
  lastName: string;

  @ApiProperty({
    description:
      'The password of the user (min 8 characters, must contain uppercase, lowercase and number)',
    example: 'Password123',
    minLength: 8
  })
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_REGEX, { message: PASSWORD_ERROR })
  password: string;
}
