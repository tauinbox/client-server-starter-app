import { ApiProperty } from '@nestjs/swagger';
import { FeatureEntityInterface } from '../interfaces/feature-entity.interface';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class FeatureEntityDto implements FeatureEntityInterface {
  @ApiProperty({ description: 'Unique identifier' })
  @IsNumber()
  id: number;

  @ApiProperty({ description: 'Entity name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Creation date' })
  createdAt: string;

  @ApiProperty({ description: 'Date of last update' })
  updatedAt: string;
}
