import {
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';
import { CreateUserDto } from '../dtos/create-user.dto';
import { UpdateUserDto } from '../dtos/update-user.dto';
import { SearchUsersQueryDto } from '../dtos/search-users-query.dto';
import { PaginatedResponseDto } from '../../../common/dtos';
import { escapeLikePattern } from '../../../common/utils/escape-like';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>
  ) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const { email, password } = createUserDto;

    const existingUser = await this.userRepository.findOne({
      where: { email }
    });
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = this.userRepository.create({
      ...createUserDto,
      password: hashedPassword
    });

    return this.userRepository.save(user);
  }

  async findAll(): Promise<User[]> {
    return this.userRepository.find();
  }

  async findPaginated(
    query: SearchUsersQueryDto
  ): Promise<PaginatedResponseDto<User>> {
    const { page, limit, sortBy, sortOrder, ...filters } = query;

    const qb = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.roles', 'role');

    if (filters.email) {
      qb.andWhere('user.email LIKE :email', {
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

    qb.orderBy(`user.${sortBy}`, sortOrder.toUpperCase() as 'ASC' | 'DESC');
    qb.skip((page - 1) * limit);
    qb.take(limit);

    const [data, total] = await qb.getManyAndCount();

    return new PaginatedResponseDto(data, total, page, limit);
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['roles']
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
      relations: ['roles']
    });
  }

  async searchUsers(filters: {
    email?: string;
    firstName?: string;
    lastName?: string;
    isActive?: boolean;
  }): Promise<User[]> {
    const queryBuilder = this.userRepository.createQueryBuilder('user');

    if (filters.email) {
      queryBuilder.andWhere('user.email LIKE :email', {
        email: `%${escapeLikePattern(filters.email)}%`
      });
    }

    if (filters.firstName) {
      queryBuilder.andWhere('user.firstName ILIKE :firstName', {
        firstName: `%${escapeLikePattern(filters.firstName)}%`
      });
    }

    if (filters.lastName) {
      queryBuilder.andWhere('user.lastName ILIKE :lastName', {
        lastName: `%${escapeLikePattern(filters.lastName)}%`
      });
    }

    if (filters.isActive !== undefined) {
      queryBuilder.andWhere('user.isActive = :isActive', {
        isActive: filters.isActive
      });
    }

    return queryBuilder.getMany();
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);

    const { unlockAccount, ...rest } = updateUserDto;
    const changes: Partial<User> = { ...rest };

    if (rest.password) {
      changes.password = await bcrypt.hash(rest.password, 10);
    }

    if (unlockAccount) {
      changes.failedLoginAttempts = 0;
      changes.lockedUntil = null;
    }

    this.userRepository.merge(user, changes);

    return this.userRepository.save(user);
  }

  async createOAuthUser(data: {
    email: string;
    firstName: string;
    lastName: string;
  }): Promise<User> {
    const user = this.userRepository.create({
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      password: null,
      isEmailVerified: true
    });
    return this.userRepository.save(user);
  }

  async incrementFailedAttempts(userId: string): Promise<void> {
    await this.userRepository.increment(
      { id: userId },
      'failedLoginAttempts',
      1
    );
  }

  async lockAccount(userId: string, lockedUntil: Date): Promise<void> {
    await this.userRepository.update(userId, { lockedUntil });
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

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.userRepository.remove(user);
  }
}
