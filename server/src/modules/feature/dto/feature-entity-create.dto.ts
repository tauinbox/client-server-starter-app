import { ApiProperty } from '@nestjs/swagger';
import { FeatureEntityInterface } from '../interfaces/feature-entity.interface';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class FeatureEntityCreateDto implements FeatureEntityInterface {
  @ApiProperty({ description: 'Entity name' })
  @IsString()
  @IsNotEmpty({ message: 'Entity name is required' })
  @MaxLength(20, { message: 'Entity name cannot be longer than 20 characters' })
  name: string;
}
