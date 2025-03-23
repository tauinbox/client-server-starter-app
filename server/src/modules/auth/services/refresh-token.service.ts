import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { RefreshToken } from '../entities/refresh-token.entity';

@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(RefreshToken)
    private repository: Repository<RefreshToken>
  ) {}

  async createRefreshToken(
    userId: string,
    token: string,
    expiresIn: number
  ): Promise<RefreshToken> {
    const refreshToken = this.repository.create({
      userId,
      token,
      expiresAt: new Date(Date.now() + expiresIn * 1000)
    });

    return this.repository.save(refreshToken);
  }

  async findByToken(token: string): Promise<RefreshToken | null> {
    return this.repository.findOne({ where: { token } });
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.repository.delete({ userId });
  }

  async revokeToken(id: string): Promise<void> {
    await this.repository.update(id, { revoked: true });
  }

  async countExpiredTokens(): Promise<number> {
    const now = new Date();
    return this.repository.count({
      where: {
        expiresAt: LessThan(now)
      }
    });
  }

  async removeExpiredTokens(): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .delete()
      .from(RefreshToken)
      .where('expires_at < :now', { now: new Date() })
      .execute();
  }

  async removeRevokedAndExpiredTokens(): Promise<void> {
    const now = new Date();
    await this.repository.delete({
      revoked: true,
      expiresAt: LessThan(now)
    });
  }

  async getTokenStatistics(): Promise<{
    totalActive: number;
    totalExpired: number;
    totalRevoked: number;
  }> {
    const now = new Date();

    const totalActive = await this.repository.count({
      where: {
        expiresAt: LessThan(now),
        revoked: false
      }
    });

    const totalExpired = await this.repository.count({
      where: {
        expiresAt: LessThan(now)
      }
    });

    const totalRevoked = await this.repository.count({
      where: {
        revoked: true
      }
    });

    return {
      totalActive,
      totalExpired,
      totalRevoked
    };
  }
}
