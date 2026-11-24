import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn
} from 'typeorm';
import { AuditAction } from '@app/shared/enums/audit-action.enum';

/**
 * The state of the row of a settings write. The row is committed before the
 * write, so it is `pending` until the write commits or fails. A row of any
 * other write has none.
 */
export type SettingsWriteOutcome = 'pending' | 'applied' | 'not_applied';

@Entity('audit_logs')
@Index('IDX_audit_logs_settings_pending', ['createdAt'], {
  where: `"settings_outcome" = 'pending'`
})
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_audit_logs_action')
  @Column({ type: 'enum', enum: AuditAction })
  action: AuditAction;

  @Index('IDX_audit_logs_actor_id')
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ name: 'actor_email', type: 'varchar', nullable: true })
  actorEmail: string | null;

  @Column({ name: 'target_id', type: 'varchar', nullable: true })
  targetId: string | null;

  @Column({ name: 'target_type', type: 'varchar', nullable: true })
  targetType: string | null;

  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, unknown> | null;

  @Column({ name: 'ip_address', type: 'varchar', nullable: true })
  ipAddress: string | null;

  @Column({ name: 'request_id', type: 'varchar', nullable: true })
  requestId: string | null;

  @Column({
    name: 'settings_outcome',
    type: 'varchar',
    length: 16,
    nullable: true
  })
  settingsOutcome: SettingsWriteOutcome | null;

  @Index('IDX_audit_logs_created_at')
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
