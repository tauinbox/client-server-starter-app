import { ApiProperty } from '@nestjs/swagger';
import type {
  BillingProviderId,
  ProductGrant,
  ProductPrice,
  ProductResponse,
  ProductType,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class ProductResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: 'pro-badge' })
  key: string;

  @ApiProperty({ example: 'Pro badge' })
  name: string;

  @ApiProperty({ example: 'Unlocks the profile badge', nullable: true })
  description: string | null;

  @ApiProperty({ enum: ['sku', 'credits', 'custom'], example: 'sku' })
  type: ProductType;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: {
      yookassa: { currency: 'RUB', amountMinor: 49000 },
      paddle: { currency: 'USD', amountMinor: 500, paddlePriceId: 'pri_01h...' }
    }
  })
  prices: Partial<Record<BillingProviderId, ProductPrice>>;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: { entitlement: 'pro-badge' }
  })
  grant: ProductGrant | null;

  @ApiProperty({ example: true })
  active: boolean;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  updatedAt: Date;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<ProductResponseDto>, ProductResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<ProductResponse, WireType<ProductResponseDto>>
>;
