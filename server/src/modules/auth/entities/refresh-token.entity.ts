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
   * When the session started. Rotation carries it over unchanged, so it bounds
   * the whole chain of rows rather than the row that holds it.
   */
  @Column({ name: 'session_started_at', type: 'timestamptz' })
  sessionStartedAt: Date;

  /**
   * The User-Agent the device sent when the session started, so the owner can
   * tell one device from another. Rotation carries it over. Null for a session
   * that started before the column existed, or for a client that sent none.
   */
  @Column({ name: 'user_agent', type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

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
