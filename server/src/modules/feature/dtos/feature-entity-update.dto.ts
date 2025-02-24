import { ApiProperty } from '@nestjs/swagger';
import { FeatureEntityInterface } from '../interfaces/feature-entity.interface';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class FeatureEntityUpdateDto implements FeatureEntityInterface {
  @ApiProperty({ description: 'Entity name' })
  @IsString()
  @IsOptional()
  @MaxLength(20, { message: 'Entity name cannot be longer than 20 characters' })
  name: string;
}
