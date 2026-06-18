import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn
} from 'typeorm';
import type {
  BillingProviderId,
  ProductGrant,
  ProductPrice,
  ProductType
} from '@app/shared/types';

@Entity('billing_products')
@Unique('UQ_billing_products_key', ['key'])
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  key: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 16 })
  type: ProductType;

  @Column({ type: 'jsonb' })
  prices: Partial<Record<BillingProviderId, ProductPrice>>;

  @Column({ type: 'jsonb', nullable: true })
  grant: ProductGrant | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
