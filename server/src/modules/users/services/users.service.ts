import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { withTransaction } from '../../../common/utils/with-transaction.util';
import * as bcrypt from 'bcrypt';
import { BCRYPT_SALT_ROUNDS } from '@app/shared/constants/auth.constants';
import { ErrorKeys } from '@app/shared/constants/error-keys';
import type { AppAbility } from '../../auth/casl/app-ability';
import { AuditService } from '../../audit/audit.service';
import { assertCan } from '../../../common/utils/assert-can.util';
import { MetricsService } from '../../core/metrics/metrics.service';
import { MailService } from '../../mail/mail.service';
import { issueEmailVerificationToken } from '../../../common/utils/issue-verification-token.util';
import { User } from '../entities/user.entity';
import { CreateUserDto } from '../dtos/create-user.dto';
import { UpdateUserDto } from '../dtos/update-user.dto';
import { SearchUsersQueryDto } from '../dtos/search-users-query.dto';
import {
  PaginatedResponseDto,
  CursorPaginatedResponseDto
} from '../../../common/dtos';
import { escapeLikePattern } from '../../../common/utils/escape-like';
import { applyKeysetPagination } from '../../../common/utils/apply-keyset-pagination.util';
import type { SearchUsersCursorQueryDto } from '../dtos/search-users-cursor-query.dto';
import { applyAbilityToUserQuery } from '../utils/apply-ability.util';

const USER_SORT_COLUMN_MAP: Record<string, string> = {
  email: 'user.email',
  firstName: 'user.firstName',
  lastName: 'user.lastName',
  isActive: 'user.isActive',
  createdAt: 'user.createdAt'
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private dataSource: DataSource,
    private auditService: AuditService,
    private metricsService: MetricsService,
    private mailService: MailService
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const { email, password } = createUserDto;

    const existingUser = await this.userRepository.findOne({
      where: { email }
    });
    if (existingUser) {
      throw new HttpException(
        {
          message: 'User with this email already exists',
          errorKey: ErrorKeys.USERS.EMAIL_EXISTS
        },
        HttpStatus.CONFLICT
      );
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    const user = this.userRepository.create({
      ...createUserDto,
      password: hashedPassword
    });

    return this.userRepository.save(user);
  }

  async findPaginated(
    query: SearchUsersQueryDto,
    ability?: AppAbility
  ): Promise<PaginatedResponseDto<User>> {
    const { page, limit, sortBy, sortOrder, includeDeleted, ...filters } =
      query;

    const qb = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.roles', 'role');

    if (includeDeleted) {
      qb.withDeleted();
    }

    if (ability) {
      applyAbilityToUserQuery(qb, ability, 'search');
    }

    this.applyUserFilters(qb, filters);

    qb.orderBy(
      USER_SORT_COLUMN_MAP[sortBy] ?? 'user.createdAt',
      sortOrder.toUpperCase() as 'ASC' | 'DESC'
    );
    qb.skip((page - 1) * limit);
    qb.take(limit);

    const [data, total] = await qb.getManyAndCount();

    return new PaginatedResponseDto(data, total, page, limit);
  }

  async findCursorPaginated(
    query: SearchUsersCursorQueryDto,
    ability?: AppAbility
  ): Promise<CursorPaginatedResponseDto<User>> {
    const { cursor, limit, sortBy, sortOrder, includeDeleted, ...filters } =
      query;

    const qb = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.roles', 'role');

    if (includeDeleted) {
      qb.withDeleted();
    }

    if (ability) {
      applyAbilityToUserQuery(qb, ability, 'search');
    }

    this.applyUserFilters(qb, filters);

    const { data, nextCursor } = await applyKeysetPagination(qb, {
      cursor,
      limit,
      sortBy,
      sortOrder,
      sortColumnMap: USER_SORT_COLUMN_MAP,
      idColumn: 'user.id'
    });

    return new CursorPaginatedResponseDto(data, nextCursor, limit);
  }

  private applyUserFilters(
    qb: ReturnType<typeof this.userRepository.createQueryBuilder>,
    filters: {
      email?: string;
      firstName?: string;
      lastName?: string;
      isActive?: boolean;
    }
  ): void {
    if (filters.email) {
      qb.andWhere('user.email ILIKE :email', {
        email: `%${escapeLikePattern(filters.email)}%`
      });
    }

    if (filters.firstName) {
      qb.andWhere('user.firstName ILIKE :firstName', {
        firstName: `%${escapeLikePattern(filters.firstName)}%`
      });
    }

    if (filters.lastName) {
      qb.andWhere('user.lastName ILIKE :lastName', {
        lastName: `%${escapeLikePattern(filters.lastName)}%`
      });
    }

    if (filters.isActive !== undefined) {
      qb.andWhere('user.isActive = :isActive', {
        isActive: filters.isActive
      });
    }
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['roles']
    });
    if (!user) {
      throw new HttpException(
        {
          message: `User with ID ${id} not found`,
          errorKey: ErrorKeys.USERS.NOT_FOUND
        },
        HttpStatus.NOT_FOUND
      );
    }

    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
      relations: ['roles']
    });
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    ability?: AppAbility
  ): Promise<User> {
    const user = await this.findOne(id);

    if (ability) {
      assertCan(
        ability,
        'update',
        user,
        this.auditService,
        { targetId: id, targetType: 'User' },
        this.metricsService
      );
    }

    const { unlockAccount, ...rest } = updateUserDto;
    const changes: Partial<User> = { ...rest };

    if (rest.password) {
      changes.password = await bcrypt.hash(rest.password, BCRYPT_SALT_ROUNDS);
    }

    if (unlockAccount) {
      changes.failedLoginAttempts = 0;
      changes.lockedUntil = null;
    }

    if (rest.isActive === false) {
      changes.tokenRevokedAt = new Date();
    }

    let pendingVerificationRawToken: string | null = null;
    if (rest.email !== undefined && rest.email !== user.email) {
      const conflicting = await this.userRepository.findOne({
        where: { email: rest.email }
      });
      if (conflicting && conflicting.id !== user.id) {
        throw new HttpException(
          {
            message: 'User with this email already exists',
            errorKey: ErrorKeys.USERS.EMAIL_EXISTS,
            field: 'email'
          },
          HttpStatus.CONFLICT
        );
      }
      const issued = issueEmailVerificationToken();
      pendingVerificationRawToken = issued.rawToken;
      changes.isEmailVerified = false;
      changes.emailVerificationToken = issued.hashedToken;
      changes.emailVerificationExpiresAt = issued.expiresAt;
    }

    this.userRepository.merge(user, changes);
    const saved = await this.userRepository.save(user);

    if (pendingVerificationRawToken) {
      this.mailService
        .sendEmailVerification(saved.email, pendingVerificationRawToken)
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
        lockedUntil: () =>
          `CASE WHEN "failed_login_attempts" + 1 >= ${maxAttempts} ` +
          `THEN NOW() + :lockInterval::interval ` +
          `ELSE "locked_until" END`
      })
      .where('id = :userId', { userId })
      .setParameters({ lockInterval: `${lockDurationMs} milliseconds` })
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

  async markEmailVerified(userId: string): Promise<void> {
    await this.userRepository.update(userId, {
      isEmailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiresAt: null
    });
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

  async clearPasswordResetToken(userId: string): Promise<void> {
    await this.userRepository.update(userId, {
      passwordResetToken: null,
      passwordResetExpiresAt: null
    });
  }

  async remove(id: string, ability?: AppAbility): Promise<void> {
    const user = await this.findOne(id);

    if (ability) {
      assertCan(
        ability,
        'delete',
        user,
        this.auditService,
        { targetId: id, targetType: 'User' },
        this.metricsService
      );
    }

    await this.userRepository.softRemove(user);
  }

  async restore(id: string, ability?: AppAbility): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['roles'],
      withDeleted: true
    });
    if (!user) {
      throw new HttpException(
        {
          message: `User with ID ${id} not found`,
          errorKey: ErrorKeys.USERS.NOT_FOUND
        },
        HttpStatus.NOT_FOUND
      );
    }

    if (ability) {
      assertCan(
        ability,
        'delete',
        user,
        this.auditService,
        { targetId: id, targetType: 'User' },
        this.metricsService
      );
    }

    await withTransaction(this.dataSource, async (manager) => {
      await manager.restore(User, id);
      await manager.update(User, id, { isActive: true });
    });
    return this.findOne(id);
  }
}
