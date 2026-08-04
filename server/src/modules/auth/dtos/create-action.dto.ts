import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CreateActionDto {
  @ApiProperty({
    description: 'Unique slug name for the action',
    example: 'publish'
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value
  )
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  name: string;

  @ApiProperty({
    description: 'Human-readable display name',
    example: 'Publish'
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  displayName: string;

  // Optional to match the column default and the update DTO: an action could
  // always be edited down to an empty description but never created with one.
  @ApiPropertyOptional({
    description: 'Description of what this action does',
    example: 'Publish a record to make it publicly visible'
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
