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

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    return this.userRepository.findOne({ where: { email } });
  }

  async searchUsers(filters: {
    email?: string;
    firstName?: string;
    lastName?: string;
    isAdmin?: boolean;
    isActive?: boolean;
  }): Promise<User[]> {
    const queryBuilder = this.userRepository.createQueryBuilder('user');

    if (filters.email) {
      queryBuilder.andWhere('user.email LIKE :email', {
        email: `%${filters.email}%`
      });
    }

    if (filters.firstName) {
      queryBuilder.andWhere('user.firstName LIKE :firstName', {
        firstName: `%${filters.firstName}%`
      });
    }

    if (filters.lastName) {
      queryBuilder.andWhere('user.lastName LIKE :lastName', {
        lastName: `%${filters.lastName}%`
      });
    }

    if (filters.isAdmin !== undefined) {
      queryBuilder.andWhere('user.isAdmin = :isAdmin', {
        isAdmin: filters.isAdmin
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

    const changes: Partial<UpdateUserDto> = { ...updateUserDto };

    if (changes.password) {
      changes.password = await bcrypt.hash(changes.password, 10);
    }

    this.userRepository.merge(user, changes);

    return this.userRepository.save(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.userRepository.remove(user);
  }
}
