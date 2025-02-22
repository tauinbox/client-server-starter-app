import { ApiProperty } from '@nestjs/swagger';
import { FeatureEntityInterface } from '../interfaces/feature-entity.interface';
import { IsOptional, IsString } from 'class-validator';

export class FeatureEntityUpdateDto implements FeatureEntityInterface {
  @ApiProperty({ description: 'Entity name' })
  @IsString()
  @IsOptional()
  name: string;
}
