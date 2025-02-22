import { ApiProperty } from '@nestjs/swagger';
import { FeatureEntityInterface } from '../interfaces/feature-entity.interface';
import { IsNotEmpty, IsString } from 'class-validator';

export class FeatureEntityCreateDto implements FeatureEntityInterface {
  @ApiProperty({ description: 'Entity name' })
  @IsString()
  @IsNotEmpty()
  name: string;
}
