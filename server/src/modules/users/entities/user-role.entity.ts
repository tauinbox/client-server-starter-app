import { Entity, ForeignKey, PrimaryColumn } from 'typeorm';
import { User } from './user.entity';
import { Role } from '../../auth/entities/role.entity';

/**
 * One role that a user holds. The row is personal data and stays with the user;
 * the role is a settings row, so `roleId` has no relation and no query joins
 * through it. The two keys copy the constraints of the schema.
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
  @ForeignKey<Role>(() => Role, {
    onDelete: 'CASCADE',
    name: 'FK_user_roles_role'
  })
  roleId: string;
}
