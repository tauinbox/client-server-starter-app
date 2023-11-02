import { ApiProperty } from '@nestjs/swagger';

export class FeatureEntityDto {
  @ApiProperty({ description: 'Unique identifier' })
  id: number;

  @ApiProperty({ description: 'Entity name' })
  name: string;
}
