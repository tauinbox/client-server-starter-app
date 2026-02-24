import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

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
  @MaxLength(100)
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
