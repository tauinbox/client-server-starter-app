import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn
} from 'typeorm';
import { Permission } from './permission.entity';

@Entity('resources')
export class Resource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column()
  subject: string;

  @Column({ name: 'display_name' })
  displayName: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @Column({ name: 'is_system', default: false })
  isSystem: boolean;

  @Column('text', {
    array: true,
    nullable: true,
    name: 'allowed_action_names',
    default: null
  })
  allowedActionNames: string[] | null;

  @Column({ name: 'is_orphaned', default: false })
  isOrphaned: boolean;

  /** Virtual field — populated by ResourceService.findAll(), not stored in DB */
  isRegistered?: boolean;

  @Column({ name: 'last_synced_at', type: 'timestamp', nullable: true })
  lastSyncedAt: Date | null;

  @OneToMany(() => Permission, (p) => p.resource)
  permissions: Permission[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
