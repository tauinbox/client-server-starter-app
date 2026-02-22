import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique
} from 'typeorm';
import { RolePermission } from './role-permission.entity';

@Entity('permissions')
@Unique(['resource', 'action'])
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  resource: string;

  @Column()
  action: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @OneToMany(() => RolePermission, (rp) => rp.permission)
  rolePermissions: RolePermission[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
