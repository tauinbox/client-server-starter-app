import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import { FeatureFlagRule } from './feature-flag-rule.entity';

@Entity('feature_flags')
export class FeatureFlag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  key: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @Column({ default: false })
  enabled: boolean;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  environments: string[];

  @Column({ default: false })
  public: boolean;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId: string | null;

  @OneToMany(() => FeatureFlagRule, (rule) => rule.flag, { cascade: true })
  rules: FeatureFlagRule[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
