import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ROLE_NAME_MAX_LENGTH } from '@app/shared/constants';

export class CreateRoleDto {
  @ApiProperty({
    description: 'The name of the role',
    example: 'editor'
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value
  )
  @IsNotEmpty()
  @IsString()
  @MaxLength(ROLE_NAME_MAX_LENGTH)
  name: string;

  @ApiPropertyOptional({
    description: 'Description of the role',
    example: 'Can edit content'
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
