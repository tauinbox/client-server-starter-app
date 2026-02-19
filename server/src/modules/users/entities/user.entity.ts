import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';
import { Exclude } from 'class-transformer';

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

  @Column({ default: false })
  isAdmin: boolean;

  @Column({ name: 'failed_login_attempts', default: 0 })
  failedLoginAttempts: number;

  @Column({ name: 'locked_until', type: 'timestamp', nullable: true })
  lockedUntil: Date | null;

  @Column({ name: 'is_email_verified', default: false })
  isEmailVerified: boolean;

  @Column({
    name: 'email_verification_token',
    type: 'varchar',
    nullable: true
  })
  @Exclude()
  emailVerificationToken: string | null;

  @Column({
    name: 'email_verification_expires_at',
    type: 'timestamp',
    nullable: true
  })
  @Exclude()
  emailVerificationExpiresAt: Date | null;

  @Column({ name: 'password_reset_token', type: 'varchar', nullable: true })
  @Exclude()
  passwordResetToken: string | null;

  @Column({
    name: 'password_reset_expires_at',
    type: 'timestamp',
    nullable: true
  })
  @Exclude()
  passwordResetExpiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
