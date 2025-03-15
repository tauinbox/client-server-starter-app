import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({
    description: 'The email of the user',
    example: 'user@example.com'
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'The first name of the user',
    example: 'John'
  })
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({
    description: 'The last name of the user',
    example: 'Doe'
  })
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({
    description: 'The password of the user (min 8 characters)',
    example: 'password123',
    minLength: 8
  })
  @IsNotEmpty()
  @MinLength(8)
  password: string;
}
