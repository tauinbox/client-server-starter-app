import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import { Exclude, Expose } from 'class-transformer';
import { DEFAULT_LOCALE } from '@app/shared/constants';
import { Role } from '../../auth/entities/role.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column({ type: 'varchar', nullable: true })
  @Exclude()
  password: string | null;

  @Column({ default: true })
  isActive: boolean;

  @ManyToMany(() => Role, (role) => role.users)
  @JoinTable({
    name: 'user_roles',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' }
  })
  roles: Role[];

  @Column({ name: 'failed_login_attempts', default: 0 })
  @Exclude()
  failedLoginAttempts: number;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  @Expose({ groups: ['privileged'] })
  lockedUntil: Date | null;

  @Column({ name: 'is_email_verified', default: false })
  isEmailVerified: boolean;

  @Column({ default: DEFAULT_LOCALE })
  locale: string;

  @Column({
    name: 'email_verification_token',
    type: 'varchar',
    nullable: true
  })
  @Exclude()
  emailVerificationToken: string | null;

  @Column({
    name: 'email_verification_expires_at',
    type: 'timestamptz',
    nullable: true
  })
  @Exclude()
  emailVerificationExpiresAt: Date | null;

  @Column({ name: 'password_reset_token', type: 'varchar', nullable: true })
  @Exclude()
  passwordResetToken: string | null;

  @Column({
    name: 'password_reset_expires_at',
    type: 'timestamptz',
    nullable: true
  })
  @Exclude()
  passwordResetExpiresAt: Date | null;

  @Column({ name: 'pending_email', type: 'varchar', nullable: true })
  @Exclude()
  pendingEmail: string | null;

  @Column({ name: 'pending_email_token', type: 'varchar', nullable: true })
  @Exclude()
  pendingEmailToken: string | null;

  @Column({
    name: 'pending_email_expires_at',
    type: 'timestamptz',
    nullable: true
  })
  @Exclude()
  pendingEmailExpiresAt: Date | null;

  @Column({ name: 'token_revoked_at', type: 'timestamptz', nullable: true })
  @Exclude()
  tokenRevokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
