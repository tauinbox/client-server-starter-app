import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import { Expose } from 'class-transformer';
import { SETTINGS_SCHEMA } from '../../../database-roles';
import { RolePermission } from './role-permission.entity';

@Entity({ name: 'roles', schema: SETTINGS_SCHEMA })
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @Column({ name: 'is_system', default: false })
  @Expose({ groups: ['privileged'] })
  isSystem: boolean;

  @Column({ name: 'is_super', default: false })
  @Expose({ groups: ['privileged'] })
  isSuper: boolean;

  @OneToMany(() => RolePermission, (rp) => rp.role)
  rolePermissions: RolePermission[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
