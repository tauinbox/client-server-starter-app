import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OAuthAccount } from '../entities/oauth-account.entity';

@Injectable()
export class OAuthAccountService {
  constructor(
    @InjectRepository(OAuthAccount)
    private readonly repository: Repository<OAuthAccount>
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

  async deleteByUserIdAndProvider(
    userId: string,
    provider: string
  ): Promise<void> {
    await this.repository.delete({ userId, provider });
  }
}
