import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { User } from '../../users/entities/user.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  @Exclude()
  token: string;

  @Column({ name: 'user_id' })
  userId: string;

  /**
   * The session this row belongs to. Rotation revokes one row and inserts the
   * next with the same value, so the id survives a refresh and can bind an
   * access token to a single device.
   */
  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  /**
   * When the session started. Rotation carries this value over unchanged, so it
   * bounds the whole chain: a derived anchor would not survive, because the
   * cleanup job deletes every revoked ancestor once it is past its own expiry.
   */
  @Column({ name: 'session_started_at', type: 'timestamptz' })
  sessionStartedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ default: false })
  revoked: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  isExpired(): boolean {
    return new Date() > this.expiresAt;
  }
}
