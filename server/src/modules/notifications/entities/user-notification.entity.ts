import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryGeneratedColumn
} from 'typeorm';
import type {
  UserNotificationKind,
  UserNotificationPayloads
} from '@app/shared/types';
import { User } from '../../users/entities/user.entity';

/**
 * A notice stored for one user, so that it reaches the user also when no
 * stream was open at the moment it was sent. The service writes `kind` and
 * `payload` together from a `UserNotificationContent`.
 */
@Entity('user_notifications')
@Index('IDX_user_notifications_user_created', ['userId', 'createdAt', 'id'])
@Index('IDX_user_notifications_user_unread', ['userId'], {
  where: '"read_at" IS NULL'
})
export class UserNotification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Exclude()
  @Column({ name: 'user_id', type: 'uuid' })
  // CASCADE: a notice has no value without its user
  @ForeignKey<User>(() => User, {
    onDelete: 'CASCADE',
    name: 'FK_user_notifications_user_id'
  })
  userId: string;

  @Column({ type: 'varchar', length: 48 })
  kind: UserNotificationKind;

  @Column({ type: 'jsonb' })
  payload: UserNotificationPayloads[UserNotificationKind];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt: Date;

  @Column({
    name: 'read_at',
    type: 'timestamptz',
    precision: 3,
    nullable: true
  })
  readAt: Date | null;
}
