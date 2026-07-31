import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants/error-keys';
import { OAuthAccount } from '../entities/oauth-account.entity';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class OAuthAccountService {
  constructor(
    @InjectRepository(OAuthAccount)
    private readonly repository: Repository<OAuthAccount>,
    private readonly dataSource: DataSource
  ) {}

  async findByProviderAndProviderId(
    provider: string,
    providerId: string
  ): Promise<OAuthAccount | null> {
    return this.repository.findOne({ where: { provider, providerId } });
  }

  async createOAuthAccount(
    userId: string,
    provider: string,
    providerId: string
  ): Promise<OAuthAccount> {
    const account = this.repository.create({ userId, provider, providerId });
    return this.repository.save(account);
  }

  async findByUserId(userId: string): Promise<OAuthAccount[]> {
    return this.repository.find({ where: { userId } });
  }

  /**
   * Unlinks one provider, refusing to strip a password-less account of its last
   * login method. The check and the delete share one transaction holding a
   * `FOR UPDATE` lock on the user row, so concurrent unlinks for the same
   * account serialize: the second waits, then counts the row the first already
   * deleted and is rejected, instead of both reading the same pre-delete state
   * and leaving an account nobody can log into.
   */
  async unlinkProvider(userId: string, provider: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' }
      });

      if (!user) {
        throw new HttpException(
          {
            message: `User with ID ${userId} not found`,
            errorKey: ErrorKeys.USERS.NOT_FOUND
          },
          HttpStatus.NOT_FOUND
        );
      }

      const accounts = await manager.find(OAuthAccount, { where: { userId } });

      if (!accounts.some((a) => a.provider === provider)) {
        throw new HttpException(
          {
            message: `No linked ${provider} account found`,
            errorKey: ErrorKeys.AUTH.OAUTH_PROVIDER_NOT_LINKED
          },
          HttpStatus.NOT_FOUND
        );
      }

      const hasPassword = user.password !== null;
      const otherOAuthCount = accounts.filter(
        (a) => a.provider !== provider
      ).length;

      if (!hasPassword && otherOAuthCount === 0) {
        throw new HttpException(
          {
            message:
              'Cannot unlink the last OAuth provider without a password set. Please set a password first.',
            errorKey: ErrorKeys.AUTH.UNLINK_LAST_PROVIDER
          },
          HttpStatus.BAD_REQUEST
        );
      }

      await manager.delete(OAuthAccount, { userId, provider });
    });
  }
}
