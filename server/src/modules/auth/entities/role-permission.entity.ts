import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique
} from 'typeorm';
import { Role } from './role.entity';
import { Permission } from './permission.entity';
import { PermissionCondition } from '@app/shared/types';

@Entity('role_permissions')
@Unique('UQ_role_permissions_role_permission', ['roleId', 'permissionId'])
export class RolePermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'role_id' })
  roleId: string;

  @Column({ name: 'permission_id' })
  permissionId: string;

  @Column({ type: 'jsonb', nullable: true })
  conditions: PermissionCondition | null;

  @ManyToOne(() => Role, (role) => role.rolePermissions, {
    onDelete: 'CASCADE'
  })
  @JoinColumn({
    name: 'role_id',
    foreignKeyConstraintName: 'FK_role_permissions_role'
  })
  role: Role;

  @ManyToOne(() => Permission, (permission) => permission.rolePermissions, {
    onDelete: 'CASCADE'
  })
  @JoinColumn({
    name: 'permission_id',
    foreignKeyConstraintName: 'FK_role_permissions_permission'
  })
  permission: Permission;
}
