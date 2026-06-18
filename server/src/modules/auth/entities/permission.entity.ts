import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique
} from 'typeorm';
import { RolePermission } from './role-permission.entity';
import { Resource } from './resource.entity';
import { Action } from './action.entity';

@Entity('permissions')
@Unique('UQ_permissions_resource_action', ['resourceId', 'actionId'])
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'resource_id' })
  resourceId: string;

  @Column({ name: 'action_id' })
  actionId: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @ManyToOne(() => Resource, (r) => r.permissions, {
    eager: true,
    onDelete: 'RESTRICT'
  })
  @JoinColumn({
    name: 'resource_id',
    foreignKeyConstraintName: 'FK_permissions_resource'
  })
  resource: Resource;

  @ManyToOne(() => Action, (a) => a.permissions, {
    eager: true,
    onDelete: 'RESTRICT'
  })
  @JoinColumn({
    name: 'action_id',
    foreignKeyConstraintName: 'FK_permissions_action'
  })
  action: Action;

  @OneToMany(() => RolePermission, (rp) => rp.permission)
  rolePermissions: RolePermission[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
