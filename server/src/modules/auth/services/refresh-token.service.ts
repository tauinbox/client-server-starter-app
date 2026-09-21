import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThan, Repository } from 'typeorm';
import { RefreshToken } from '../entities/refresh-token.entity';
import { hashToken } from '../../../common/utils/hash-token';

@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(RefreshToken)
    private repository: Repository<RefreshToken>
  ) {}

  async createRefreshToken(
    userId: string,
    token: string,
    expiresIn: number,
    sessionId: string,
    userAgent: string | null
  ): Promise<RefreshToken> {
    const refreshToken = this.repository.create({
      userId,
      sessionId,
      sessionStartedAt: new Date(),
      userAgent,
      token: hashToken(token),
      expiresAt: new Date(Date.now() + expiresIn * 1000)
    });

    return this.repository.save(refreshToken);
  }

  /**
   * The live row of each session of the user, newest activity first. Rotation
   * revokes one row and inserts the next inside one transaction, so a session
   * holds one live row. The dedup covers a row that a concurrent write left
   * behind all the same.
   */
  async findLiveSessions(userId: string): Promise<RefreshToken[]> {
    const rows = await this.repository.find({
      where: { userId, revoked: false, expiresAt: MoreThan(new Date()) },
      order: { createdAt: 'DESC' }
    });

    const seen = new Set<string>();
    return rows.filter((row) => {
      if (seen.has(row.sessionId)) return false;
      seen.add(row.sessionId);
      return true;
    });
  }

  /**
   * Ends one live session of this user. The user id is part of the lookup and
   * of the delete, so an id that belongs to another account ends nothing and
   * reads the same as an id that does not exist.
   */
  async deleteUserSession(userId: string, sessionId: string): Promise<boolean> {
    const live = await this.repository.exists({
      where: {
        userId,
        sessionId,
        revoked: false,
        expiresAt: MoreThan(new Date())
      }
    });
    if (!live) return false;

    await this.repository.delete({ userId, sessionId });
    return true;
  }

  /**
   * Ends every session of this user except one, and returns how many live
   * sessions it ended. It writes no `tokenRevokedAt`, because that stamp would
   * end the kept session too.
   */
  async deleteOtherSessions(
    userId: string,
    keepSessionId: string
  ): Promise<number> {
    const ended = (await this.findLiveSessions(userId)).filter(
      (row) => row.sessionId !== keepSessionId
    ).length;

    await this.repository
      .createQueryBuilder()
      .delete()
      .from(RefreshToken)
      .where('user_id = :userId AND session_id <> :keepSessionId', {
        userId,
        keepSessionId
      })
      .execute();

    return ended;
  }

  /**
   * Whether the session still holds a usable refresh row. This is what makes an
   * access token die with the sign-out of its own device: the row is gone, so
   * the session is over even though the token has not expired.
   */
  async hasLiveSession(sessionId: string): Promise<boolean> {
    return this.repository.exists({
      where: {
        sessionId,
        revoked: false,
        expiresAt: MoreThan(new Date())
      }
    });
  }

  /**
   * Ends one session and nothing else. Rotation leaves revoked ancestors behind,
   * so the whole chain goes: a leftover ancestor would otherwise keep answering
   * the reuse detector for a session that no longer exists.
   */
  async deleteBySessionId(sessionId: string): Promise<number> {
    const result = await this.repository.delete({ sessionId });
    return result.affected ?? 0;
  }

  async findByToken(token: string): Promise<RefreshToken | null> {
    return this.repository.findOne({ where: { token: hashToken(token) } });
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.repository.delete({ userId });
  }

  async pruneOldestTokens(userId: string, maxSessions: number): Promise<void> {
    const count = await this.repository.count({
      where: { userId, revoked: false }
    });

    if (count <= maxSessions) return;

    const excess = count - maxSessions;

    await this.repository
      .createQueryBuilder()
      .delete()
      .from(RefreshToken)
      .where(
        'id IN (SELECT id FROM refresh_tokens WHERE user_id = :userId AND revoked = false ORDER BY created_at ASC LIMIT :excess)',
        { userId, excess }
      )
      .execute();
  }

  async revokeToken(id: string): Promise<void> {
    await this.repository.update(id, { revoked: true });
  }

  async removeExpiredTokens(): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(RefreshToken)
      .where('expires_at < :now', { now: new Date() })
      .execute();
    return result.affected ?? 0;
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
        expiresAt: MoreThan(now),
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
