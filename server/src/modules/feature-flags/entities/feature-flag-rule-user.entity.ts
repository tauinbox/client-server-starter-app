import { Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * One member of a `user` rule. The row is personal data and stays with the
 * user; the rule is a settings row, so `ruleId` has no relation and no foreign
 * key. The settings change log deletes the rows of a removed rule; until then a
 * row gives nothing, because no rule reads it.
 */
@Entity('feature_flag_rule_users')
@Index('IDX_feature_flag_rule_users_user_id', ['userId'])
export class FeatureFlagRuleUser {
  @PrimaryColumn({
    name: 'rule_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_feature_flag_rule_users'
  })
  ruleId: string;

  @PrimaryColumn({
    name: 'user_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_feature_flag_rule_users'
  })
  @ForeignKey<User>(() => User, {
    onDelete: 'CASCADE',
    name: 'FK_feature_flag_rule_users_user'
  })
  userId: string;
}
