import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import type {
  FeatureFlagRuleEffect,
  FeatureFlagRulePayload,
  FeatureFlagRuleType
} from '@app/shared/types';
import { FeatureFlag } from './feature-flag.entity';

@Entity('feature_flag_rules')
export class FeatureFlagRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'flag_id', type: 'uuid' })
  flagId: string;

  @ManyToOne(() => FeatureFlag, (flag) => flag.rules, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'flag_id' })
  flag: FeatureFlag;

  @Column({ type: 'varchar', length: 32 })
  type: FeatureFlagRuleType;

  @Column({ type: 'varchar', length: 16 })
  effect: FeatureFlagRuleEffect;

  @Column({ type: 'jsonb' })
  payload: FeatureFlagRulePayload;

  // Uses clock_timestamp() (not now()) so bulk inserts within one transaction
  // get distinct microsecond timestamps — the basis for stable display order.
  @Column({
    name: 'created_at',
    type: 'timestamp',
    precision: 6,
    default: () => 'clock_timestamp()'
  })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
