import {
  Column,
  CreateDateColumn,
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

  @Column({ type: 'integer', default: 0 })
  priority: number;

  @Column({ type: 'varchar', length: 32 })
  type: FeatureFlagRuleType;

  @Column({ type: 'varchar', length: 16 })
  effect: FeatureFlagRuleEffect;

  @Column({ type: 'jsonb' })
  payload: FeatureFlagRulePayload;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
