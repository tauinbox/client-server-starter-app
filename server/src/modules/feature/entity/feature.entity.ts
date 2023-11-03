import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('feature')
export class FeatureEntity {
  @PrimaryColumn('uuid', { nullable: false })
  id: number;

  @Column({ name: 'name', type: 'text', nullable: false })
  name: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
