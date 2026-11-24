import { Entity, ForeignKey, PrimaryColumn } from 'typeorm';
import { User } from './user.entity';

/**
 * One role that a user holds. The row is personal data and stays with the user;
 * the role is a settings row, so `roleId` has no relation, no foreign key and
 * no query joins through it. The settings change log deletes the rows of a
 * deleted role after it drops the caches of their holders; until then a row
 * gives nothing, because the role it names is not found.
 */
@Entity('user_roles')
export class UserRole {
  @PrimaryColumn({
    name: 'user_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_user_roles'
  })
  @ForeignKey<User>(() => User, {
    onDelete: 'CASCADE',
    name: 'FK_user_roles_user'
  })
  userId: string;

  @PrimaryColumn({
    name: 'role_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_user_roles'
  })
  roleId: string;
}
