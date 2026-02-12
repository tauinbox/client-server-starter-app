import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'The first name of the user',
    example: 'John'
  })
  @IsOptional()
  @IsNotEmpty()
  firstName?: string;

  @ApiPropertyOptional({
    description: 'The last name of the user',
    example: 'Doe'
  })
  @IsOptional()
  @IsNotEmpty()
  lastName?: string;

  @ApiPropertyOptional({
    description: 'New password (min 8 characters)',
    example: 'newpassword123',
    minLength: 8
  })
  @IsOptional()
  @MinLength(8)
  password?: string;
}
