import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiError } from '../../../common/errors/api-error';
import { DataSource, EntityManager, IsNull, Not, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm';
import { subject } from '@casl/ability';
import { withTransaction } from '../../../common/utils/with-transaction.util';
import { isUniqueViolation } from '../../../common/utils/is-unique-violation.util';
import { keyedUpdate } from '../../../common/utils/keyed-update.util';
import { hashPassword } from '../../../common/utils/password-hash';
import {
  ErrorKeys,
  USER_LIST_QUERY,
  VERIFICATION_TOKEN_EXPIRY_MS
} from '@app/shared/constants';
import { SYSTEM_ABILITY } from '../../auth/casl/app-ability';
import type { AbilityOrSystem, AppAbility } from '../../auth/casl/app-ability';
import { AuditService } from '../../audit/audit.service';
import type { AuditLogParams } from '../../audit/audit.service';
import { assertCan } from '../../../common/utils/assert-can.util';
import { assertNotSuperTarget } from '../../../common/utils/assert-not-super-target.util';
import { MetricsService } from '../../core/metrics/metrics.service';
import { BreachedPasswordService } from '../../auth/breached-password/breached-password.service';
import { MailService } from '../../mail/mail.service';
import { issueMailedToken } from '../../../common/utils/issue-mailed-token.util';
import { withChanges } from '@app/shared/utils/changed-fields';
import { User } from '../entities/user.entity';
import { addressTakenWhere, emailExistsConflict } from '../utils/email-taken';
import { CreateUserDto } from '../dtos/create-user.dto';
import { UpdateUserDto } from '../dtos/update-user.dto';
import type { CursorPaginatedResponseDto } from '../../../common/dtos';
import {
  applyList,
  type ListColumns
} from '../../../common/utils/apply-list-query.util';
import type { SearchUsersCursorQueryDto } from '../dtos/search-users-cursor-query.dto';
import { applyAbilityToUserQuery } from '../../../common/utils/apply-ability.util';

// The search casts the uuid to text to match a part of it; the ids filter
// compares the column itself so that it keeps the primary key index.
const USER_LIST_COLUMNS: ListColumns<typeof USER_LIST_QUERY> = {
  search: {
    email: 'user.email',
    name: 'user.name',
    id: 'CAST(user.id AS text)'
  },
  filters: {
    email: 'user.email',
    name: 'user.name',
    ids: 'user.id',
    isActive: 'user.isActive',
    isEmailVerified: 'user.isEmailVerified',
    mfaEnabled: 'user.totpEnabledAt',
    hasPassword: 'user.password',
    isLocked: 'user.lockedUntil'
  },
  sort: {
    email: 'user.email',
    name: 'user.name',
    isActive: 'user.isActive',
    createdAt: 'user.createdAt'
  },
  id: 'user.id'
};

/**
 * The audit rows of an administrator write, built from the record the write
 * produced. They are written in the transaction of the write, so the change
 * never commits without them.
 */
export type UserAuditRows = (user: User) => AuditLogParams[];

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private dataSource: DataSource,
    private auditService: AuditService,
    private metricsService: MetricsService,
    private mailService: MailService,
    private breachedPasswordService: BreachedPasswordService
  ) {}

  async create(
    createUserDto: CreateUserDto,
    ability: AbilityOrSystem,
    actorId?: string,
    audit?: UserAuditRows
  ): Promise<User> {
    const { email, password, ...subjectFields } = createUserDto;

    // The route-level @Authorize check is type-level and ignores conditions,
    // so a conditional create grant is re-evaluated against the record the
    // caller is asking to create. The password is deliberately left out of the
    // subject: no authorization condition can legitimately be written over it.
    if (ability !== SYSTEM_ABILITY) {
      assertCan(
        ability,
        'create',
        subject('User', { email, ...subjectFields }),
        this.auditService,
        { actorId, targetType: 'User' },
        this.metricsService
      );
    }

    // Ahead of the address conflict, matching AuthService.register: both routes
    // carry the same DTO and must answer the same way for the same body.
    await this.breachedPasswordService.assertNotBreached(
      password,
      createUserDto
    );

    const existingUser = await this.userRepository.findOne({
      where: addressTakenWhere(email)
    });
    if (existingUser) throw emailExistsConflict();

    const { hash, version } = await hashPassword(password);

    const user = this.userRepository.create({
      ...createUserDto,
      password: hash,
      passwordHashVersion: version
    });

    try {
      return await withTransaction(this.dataSource, async (manager) => {
        const saved = await manager.save(user);
        await this.writeAudit(manager, audit, saved);
        return saved;
      });
    } catch (error: unknown) {
      throw this.emailConflictOrOriginal(error);
    }
  }

  private async writeAudit(
    manager: EntityManager,
    audit: UserAuditRows | undefined,
    user: User
  ): Promise<void> {
    for (const params of audit?.(user) ?? []) {
      await this.auditService.log(params, manager);
    }
  }

  // Every unique index on users covers an address, so any violation here is an
  // address collision.
  private emailConflictOrOriginal(error: unknown): unknown {
    return isUniqueViolation(error) ? emailExistsConflict() : error;
  }

  async findCursorPaginated(
    query: SearchUsersCursorQueryDto,
    ability: AbilityOrSystem
  ): Promise<CursorPaginatedResponseDto<User>> {
    const qb = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.roles', 'role');

    if (query.includeDeleted) {
      qb.withDeleted();
    }

    if (ability !== SYSTEM_ABILITY) {
      applyAbilityToUserQuery(qb, ability, 'search');
    }

    if (query.role) {
      // Separate inner join (not AndSelect) so the filter narrows the user set
      // without trimming the roles loaded for display via leftJoinAndSelect.
      qb.innerJoin('user.roles', 'roleFilter', 'roleFilter.name = :role', {
        role: query.role
      });
    }

    return applyList(qb, USER_LIST_QUERY, USER_LIST_COLUMNS, query);
  }

  async findOne(
    id: string,
    ability: AbilityOrSystem,
    actorId?: string
  ): Promise<User> {
    const user = await this.loadUser(id);
    if (ability !== SYSTEM_ABILITY) {
      assertCan(
        ability,
        'read',
        subject('User', user),
        this.auditService,
        { actorId, targetId: id, targetType: 'User' },
        this.metricsService
      );
    }
    return user;
  }

  private async loadUser(id: string): Promise<User> {
    // A falsy id would be dropped from the WHERE clause and silently resolve to
    // an arbitrary user rather than matching nothing.
    if (!id) {
      throw new ApiError(ErrorKeys.USERS.NOT_FOUND, 'User id is required');
    }

    const user = await this.userRepository.findOne({
      where: { id },
      relations: { roles: true }
    });
    if (!user) throw userNotFound(id);

    return user;
  }

  /**
   * The lookup for a caller that must answer a missing account itself.
   * `findOne` throws `USERS.NOT_FOUND`, which is the wrong answer on a token
   * path. A
   * soft-deleted account is missing here too.
   */
  async findById(id: string): Promise<User | null> {
    if (!id) return null;

    return this.userRepository.findOne({
      where: { id },
      relations: { roles: true }
    });
  }

  /** `findById` that also returns a soft-deleted account. */
  async findByIdWithDeleted(id: string): Promise<User | null> {
    if (!id) return null;

    return this.userRepository.findOne({ where: { id }, withDeleted: true });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
      relations: { roles: true }
    });
  }

  /**
   * The instance check of a write on `target`: `assertCan`, then the rule that
   * an account holding a super role is out of reach of a non-super actor.
   */
  assertCanWrite(
    ability: AppAbility,
    action: 'update' | 'delete',
    target: User,
    actorId?: string
  ): void {
    assertCan(
      ability,
      action,
      subject('User', target),
      this.auditService,
      { actorId, targetId: target.id, targetType: 'User' },
      this.metricsService
    );
    assertNotSuperTarget(
      ability,
      action,
      target,
      this.auditService,
      actorId,
      this.metricsService
    );
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    ability: AbilityOrSystem,
    actorId?: string,
    audit?: UserAuditRows
  ): Promise<User> {
    const user = await this.loadUser(id);
    const { unlockAccount, ...rest } = updateUserDto;

    if (ability !== SYSTEM_ABILITY) {
      this.assertCanWrite(ability, 'update', user, actorId);
      // The record after the write is checked too: else a grant scoped by a
      // writable field lets the caller move a user out of its own scope. The
      // secrets of the body are not fields that a condition reads.
      this.assertCanWrite(
        ability,
        'update',
        withChanges(user, {
          ...rest,
          password: undefined,
          currentPassword: undefined,
          code: undefined
        }),
        actorId
      );
    }
    // Only columns: the body also carries the step-up factors of the caller.
    const changes: QueryDeepPartialEntity<User> = {
      name: rest.name,
      email: rest.email,
      locale: rest.locale,
      isActive: rest.isActive
    };

    if (rest.password) {
      // After the ability check, which decides whether this caller may write to
      // the record at all, and before the hash.
      // The name and email checked are the ones the record has after this
      // write, so a rename in the same body is covered.
      await this.breachedPasswordService.assertNotBreached(rest.password, {
        email: rest.email ?? user.email,
        name: rest.name ?? user.name
      });
      const { hash, version } = await hashPassword(rest.password);
      changes.password = hash;
      changes.passwordHashVersion = version;
      // A password change voids every mailed proof of ownership, the same rule
      // resetPassword states: a link kept from before the change must not still
      // take the account, and neither must an email change in flight.
      changes.passwordResetToken = null;
      changes.passwordResetExpiresAt = null;
      changes.pendingEmail = null;
      changes.pendingEmailToken = null;
      changes.pendingEmailExpiresAt = null;
    }

    if (unlockAccount) {
      changes.failedLoginAttempts = 0;
      changes.lockedUntil = null;
    }

    if (rest.isActive === false) {
      changes.tokenRevokedAt = new Date();
      // Cancel any in-flight self-service email change so a mailed link cannot
      // confirm against a disabled row, the same reason the soft delete clears
      // these three columns. A reset link would otherwise revive on
      // reactivation.
      changes.pendingEmail = null;
      changes.pendingEmailToken = null;
      changes.pendingEmailExpiresAt = null;
      changes.passwordResetToken = null;
      changes.passwordResetExpiresAt = null;
    }

    let pendingVerificationRawToken: string | null = null;
    if (rest.email !== undefined && rest.email !== user.email) {
      const conflicting = await this.userRepository.findOne({
        where: addressTakenWhere(rest.email)
      });
      if (conflicting && conflicting.id !== user.id) {
        throw emailExistsConflict();
      }
      const issued = issueMailedToken(VERIFICATION_TOKEN_EXPIRY_MS);
      pendingVerificationRawToken = issued.rawToken;
      changes.isEmailVerified = false;
      changes.emailVerificationToken = issued.hashedToken;
      changes.emailVerificationExpiresAt = issued.expiresAt;
      // Admin-set email overrides any self-service change in flight, and voids
      // a reset link mailed to the old address: this change exists to take the
      // account back from whoever controls that address.
      changes.pendingEmail = null;
      changes.pendingEmailToken = null;
      changes.pendingEmailExpiresAt = null;
      changes.passwordResetToken = null;
      changes.passwordResetExpiresAt = null;
    }

    let saved: User;
    try {
      saved = await withTransaction(this.dataSource, async (manager) => {
        // Keyed on the live row: an edit that loses to a delete answers not
        // found, and a concurrent write to another column (a password reset)
        // is kept.
        const live = { id: user.id, deletedAt: IsNull() };
        if (!(await keyedUpdate(manager, User, live, changes))) {
          throw userNotFound(id);
        }
        const written = await manager.findOneOrFail(User, {
          where: { id: user.id },
          relations: { roles: true }
        });
        await this.writeAudit(manager, audit, written);
        return written;
      });
    } catch (error: unknown) {
      throw this.emailConflictOrOriginal(error);
    }

    if (pendingVerificationRawToken) {
      this.mailService
        .sendEmailVerification(
          saved.email,
          pendingVerificationRawToken,
          saved.locale
        )
        .catch((err) =>
          this.logger.error(
            'Failed to send verification email after email change',
            err
          )
        );
    }

    return saved;
  }

  async incrementFailedAttemptsAndLockIfNeeded(
    userId: string,
    maxAttempts: number,
    lockDurationMs: number
  ): Promise<{ failedLoginAttempts: number; lockedUntil: Date | null }> {
    const result = await this.userRepository
      .createQueryBuilder()
      .update(User)
      .set({
        failedLoginAttempts: () => '"failed_login_attempts" + 1',
        // An open lock is kept as it is, so the rest of a burst that lands after
        // it cannot push the window further out.
        lockedUntil: () =>
          `CASE WHEN "failed_login_attempts" + 1 >= :maxAttempts::int ` +
          `AND ("locked_until" IS NULL OR "locked_until" <= NOW()) ` +
          `THEN NOW() + :lockInterval::interval ` +
          `ELSE "locked_until" END`
      })
      .where('id = :userId', { userId })
      .setParameters({
        maxAttempts,
        lockInterval: `${lockDurationMs} milliseconds`
      })
      .returning(['failedLoginAttempts', 'lockedUntil'])
      .execute();

    const raw = (
      result.raw as {
        failed_login_attempts: number;
        locked_until: string | null;
      }[]
    )[0];

    if (!raw) {
      throw new Error(
        `incrementFailedAttemptsAndLockIfNeeded: user ${userId} not found or UPDATE returned no rows`
      );
    }

    return {
      failedLoginAttempts: raw.failed_login_attempts,
      lockedUntil: raw.locked_until ? new Date(raw.locked_until) : null
    };
  }

  /**
   * Moves a legacy row to the current hash format. Keyed on the old hash, so a
   * password change that lands in between keeps its own value.
   */
  async upgradePasswordHash(
    user: Pick<User, 'id' | 'password'>,
    password: string
  ): Promise<void> {
    if (user.password === null) return;
    const { hash, version } = await hashPassword(password);
    await this.userRepository.update(
      { id: user.id, password: user.password },
      { password: hash, passwordHashVersion: version }
    );
  }

  async resetLoginAttempts(userId: string): Promise<void> {
    await this.userRepository.update(userId, {
      failedLoginAttempts: 0,
      lockedUntil: null
    });
  }

  async setEmailVerificationToken(
    userId: string,
    hashedToken: string,
    expiresAt: Date
  ): Promise<void> {
    await this.userRepository.update(userId, {
      emailVerificationToken: hashedToken,
      emailVerificationExpiresAt: expiresAt
    });
  }

  async findByEmailVerificationToken(
    hashedToken: string
  ): Promise<User | null> {
    return this.userRepository.findOne({
      where: { emailVerificationToken: hashedToken }
    });
  }

  /**
   * Keyed on the proof the caller consumed: a change that lands between the
   * caller's read and this write voids the proof, and the write then misses.
   */
  async markEmailVerified(
    userId: string,
    proof: { emailVerificationToken: string } | { email: string }
  ): Promise<boolean> {
    const result = await this.userRepository.update(
      { id: userId, isActive: true, ...proof },
      {
        isEmailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpiresAt: null
      }
    );
    return result.affected !== 0;
  }

  async setPasswordResetToken(
    userId: string,
    hashedToken: string,
    expiresAt: Date
  ): Promise<void> {
    await this.userRepository.update(userId, {
      passwordResetToken: hashedToken,
      passwordResetExpiresAt: expiresAt
    });
  }

  async findByPasswordResetToken(hashedToken: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { passwordResetToken: hashedToken }
    });
  }

  async clearPendingEmailChange(userId: string): Promise<void> {
    await this.userRepository.update(userId, {
      pendingEmail: null,
      pendingEmailToken: null,
      pendingEmailExpiresAt: null
    });
  }

  async remove(
    id: string,
    ability: AbilityOrSystem,
    actorId?: string,
    audit?: UserAuditRows
  ): Promise<void> {
    const user = await this.loadUser(id);

    if (ability !== SYSTEM_ABILITY) {
      this.assertCanWrite(ability, 'delete', user, actorId);
    }

    // Clear mailed tokens BEFORE soft-delete so a stale link cannot outlive
    // deletedAt and confirm, or revive on restore. Both
    // writes share one transaction so a failing soft-delete cannot leave a
    // live row stripped of its pending email change. Keyed on the live row, so
    // of two concurrent deletes one writes and audits and the other answers
    // not found.
    await withTransaction(this.dataSource, async (manager) => {
      const live = { id, deletedAt: IsNull() };
      await manager.update(User, live, {
        pendingEmail: null,
        pendingEmailToken: null,
        pendingEmailExpiresAt: null,
        passwordResetToken: null,
        passwordResetExpiresAt: null
      });
      const { affected } = await manager.softDelete(User, live);
      if (affected === 0) throw userNotFound(id);
      await this.writeAudit(manager, audit, user);
    });
  }

  async restore(
    id: string,
    ability: AbilityOrSystem,
    actorId?: string,
    audit?: UserAuditRows
  ): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: { roles: true },
      withDeleted: true
    });
    if (!user) throw userNotFound(id);

    if (ability !== SYSTEM_ABILITY) {
      this.assertCanWrite(ability, 'delete', user, actorId);
    }

    // Lift the soft-delete only. `isActive` is an independent administrative
    // state gated by the `update` action, so reactivating here would let a
    // principal holding just `delete` re-enable a deactivated account by
    // deleting and restoring it.
    if (!user.deletedAt) throw notDeleted(id);
    // Keyed on the deleted state, so of two concurrent restores one writes
    // and audits and the other is refused.
    await withTransaction(this.dataSource, async (manager) => {
      const { affected } = await manager.restore(User, {
        id,
        deletedAt: Not(IsNull())
      });
      if (affected === 0) throw notDeleted(id);
      await this.writeAudit(manager, audit, user);
    });
    return this.loadUser(id);
  }
}

function notDeleted(id: string): ApiError {
  return new ApiError(
    ErrorKeys.USERS.NOT_DELETED,
    `User with ID ${id} is not deleted, so there is nothing to restore`
  );
}

function userNotFound(id: string): ApiError {
  return new ApiError(
    ErrorKeys.USERS.NOT_FOUND,
    `User with ID ${id} not found`
  );
}
