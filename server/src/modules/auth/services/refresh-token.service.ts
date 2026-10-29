import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { RefreshToken } from '../entities/refresh-token.entity';
import { hashToken } from '../../../common/utils/hash-token';
import type { SessionClient } from '../utils/session-client';
import { GeoIpService } from './geo-ip.service';

/** The device fields that each row of a session carries. */
export type SessionDevice = Pick<
  RefreshToken,
  'userAgent' | 'ipAddress' | 'countryCode' | 'city'
>;

/** The fields of a refresh row that the caller supplies. */
export type RefreshRowFields = Pick<
  RefreshToken,
  'userId' | 'sessionId' | 'sessionStartedAt'
> &
  SessionDevice;

/** The unused successor that a lost rotation response left behind. */
export interface LostResponseSuccessor {
  /** Time since the rotation that issued the successor. */
  ageMs: number;
  /** The address that sent the rotation whose response was lost. */
  ipAddress: string | null;
}

@Injectable()
export class RefreshTokenService {
  /** `JWT_REFRESH_EXPIRATION`: the lifetime of one refresh row. */
  readonly lifetimeSeconds: number;

  constructor(
    @InjectRepository(RefreshToken)
    private repository: Repository<RefreshToken>,
    private readonly geoIp: GeoIpService,
    configService: ConfigService
  ) {
    this.lifetimeSeconds = Number(
      configService.getOrThrow<string>('JWT_REFRESH_EXPIRATION')
    );
  }

  /**
   * The row that stores `token`, at sign-in and at rotation alike. Only the
   * hash is stored, and the row expires one lifetime from now.
   */
  buildRow(fields: RefreshRowFields, token: string): Partial<RefreshToken> {
    return {
      ...fields,
      token: hashToken(token),
      expiresAt: new Date(Date.now() + this.lifetimeSeconds * 1000)
    };
  }

  async createRefreshToken(
    userId: string,
    token: string,
    sessionId: string,
    client: SessionClient
  ): Promise<RefreshToken> {
    const location = await this.geoIp.lookup(client.ipAddress);
    const refreshToken = this.repository.create(
      this.buildRow(
        {
          userId,
          sessionId,
          sessionStartedAt: new Date(),
          userAgent: client.userAgent,
          ipAddress: client.ipAddress,
          countryCode: location.countryCode,
          city: location.city
        },
        token
      )
    );

    return this.repository.save(refreshToken);
  }

  /**
   * The device fields of the row that replaces `previous` at rotation. The
   * User-Agent carries over, because it names the device the session started
   * on. The address is the one the refresh came from, so the list shows where
   * the device was last active. The location is resolved again only when the
   * address changed.
   */
  async rotatedDevice(
    previous: RefreshToken,
    ipAddress: string | null
  ): Promise<SessionDevice> {
    const address = ipAddress ?? previous.ipAddress;
    const location =
      address === previous.ipAddress
        ? { countryCode: previous.countryCode, city: previous.city }
        : await this.geoIp.lookup(address);

    return {
      userAgent: previous.userAgent,
      ipAddress: address,
      ...location
    };
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
   *
   * The delete is the existence check, so of two concurrent requests for one
   * session only one reports the end.
   */
  async deleteUserSession(userId: string, sessionId: string): Promise<boolean> {
    const { affected } = await this.repository
      .createQueryBuilder()
      .delete()
      .from(RefreshToken)
      .where('user_id = :userId AND session_id = :sessionId')
      .andWhere(
        'EXISTS (SELECT 1 FROM refresh_tokens live WHERE live.user_id = :userId AND live.session_id = :sessionId AND live.revoked = false AND live.expires_at > :now)'
      )
      .setParameters({ userId, sessionId, now: new Date() })
      .execute();

    return (affected ?? 0) > 0;
  }

  /**
   * Ends every session of this user except one, and returns how many live
   * sessions it ended. It writes no `tokenRevokedAt`, because that stamp would
   * end the kept session too.
   *
   * The count comes from the deleted rows, so a session that a concurrent
   * request ended first is not counted again.
   */
  async deleteOtherSessions(
    userId: string,
    keepSessionId: string
  ): Promise<number> {
    const now = Date.now();
    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .from(RefreshToken)
      .where('user_id = :userId AND session_id <> :keepSessionId', {
        userId,
        keepSessionId
      })
      .returning('session_id, revoked, expires_at')
      .execute();

    const rows = result.raw as {
      session_id: string;
      revoked: boolean;
      expires_at: Date;
    }[];
    const ended = new Set(
      rows
        .filter((row) => !row.revoked && row.expires_at.getTime() > now)
        .map((row) => row.session_id)
    );
    return ended.size;
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

  /**
   * The live successor when a revoked row is the immediate predecessor of a
   * successor that was never used, otherwise null. That is the shape a rotation
   * leaves when its response never reached the browser (a tab closed, a laptop
   * asleep, a network drop), which then presents the old cookie again, possibly
   * hours later. The age of the successor does not matter: until it is used,
   * the browser cannot hold it.
   *
   * The ordering and the age run in SQL: `created_at` holds microseconds and
   * reads back as a millisecond Date, so a value sent back from JS could
   * misorder two rows created in the same millisecond.
   */
  async findLostResponseSuccessor(
    token: RefreshToken
  ): Promise<LostResponseSuccessor | null> {
    const result = await this.repository
      .createQueryBuilder('rt')
      .select(
        'COUNT(*) = 1 AND COALESCE(BOOL_AND(NOT rt.revoked), false)',
        'replay'
      )
      .addSelect(
        'EXTRACT(EPOCH FROM (NOW() - MAX(rt.created_at))) * 1000',
        'age_ms'
      )
      .addSelect('MAX(rt.ip_address)', 'ip_address')
      .where('rt.session_id = :sessionId', { sessionId: token.sessionId })
      .andWhere(
        'rt.created_at > (SELECT prev.created_at FROM refresh_tokens prev WHERE prev.id = :id)',
        { id: token.id }
      )
      .getRawOne<{
        replay: boolean;
        age_ms: string | number | null;
        ip_address: string | null;
      }>();

    if (result?.replay !== true) return null;
    return {
      ageMs: Math.round(Number(result.age_ms)),
      ipAddress: result.ip_address
    };
  }

  async findByToken(token: string): Promise<RefreshToken | null> {
    return this.repository.findOne({ where: { token: hashToken(token) } });
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.repository.delete({ userId });
  }

  /**
   * Ends the oldest sessions whole, for the reason given at `deleteBySessionId`.
   */
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
        'user_id = :userId AND session_id IN (SELECT session_id FROM refresh_tokens WHERE user_id = :userId AND revoked = false ORDER BY created_at ASC LIMIT :excess)',
        { userId, excess }
      )
      .execute();
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
}
