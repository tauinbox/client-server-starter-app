import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn
} from 'typeorm';
import { SETTINGS_SCHEMA } from '../../../database-roles';
import { Permission } from './permission.entity';

@Entity({ name: 'actions', schema: SETTINGS_SCHEMA })
export class Action {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @OneToMany(() => Permission, (p) => p.action)
  permissions: Permission[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt: Date;
}
