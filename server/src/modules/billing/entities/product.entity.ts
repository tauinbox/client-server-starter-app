import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import type {
  BillingProviderId,
  ProductGrant,
  ProductPrice,
  ProductType
} from '@app/shared/types';

@Entity('billing_products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  key: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
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
