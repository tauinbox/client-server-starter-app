import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { isIP } from 'net';
import { Reader } from 'maxmind';
import type { CityResponse } from 'maxmind';

export interface GeoLocation {
  countryCode: string | null;
  city: string | null;
}

const NO_LOCATION: GeoLocation = { countryCode: null, city: null };

/** Keep the database this long after the last lookup, then release it. */
export const GEOIP_IDLE_RELEASE_MS = 60_000;

/**
 * Resolves an IP address to a country and a city from a local DB-IP Lite
 * (MMDB) file. No address leaves the server.
 *
 * The city database is about 130 MB and is read whole into memory. A lookup
 * is needed only when a session starts or moves to a new address, so the
 * file is loaded on demand and released after an idle period instead of
 * holding that memory for the life of the process.
 *
 * Every failure resolves to "no location": the location is display data, and
 * a sign-in must never fail because of it.
 */
@Injectable()
export class GeoIpService {
  private readonly logger = new Logger(GeoIpService.name);
  private readonly dbPath: string | undefined;
  private reader: Promise<Reader<CityResponse> | null> | null = null;
  private releaseTimer: NodeJS.Timeout | undefined;

  constructor(configService: ConfigService) {
    this.dbPath = configService.get<string>('GEOIP_DB_PATH') || undefined;
  }

  async lookup(ip: string | null): Promise<GeoLocation> {
    if (!this.dbPath || !ip || isIP(ip) === 0) return NO_LOCATION;

    const reader = await this.acquire(this.dbPath);
    const record = reader?.get(ip);
    return {
      countryCode: record?.country?.iso_code ?? null,
      city: record?.city?.names?.en ?? null
    };
  }

  private acquire(path: string): Promise<Reader<CityResponse> | null> {
    this.reader ??= this.load(path);
    clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => {
      this.reader = null;
    }, GEOIP_IDLE_RELEASE_MS).unref();
    return this.reader;
  }

  private async load(path: string): Promise<Reader<CityResponse> | null> {
    try {
      return new Reader<CityResponse>(await readFile(path));
    } catch (err) {
      // Not cached, so a file that appears later is used.
      this.reader = null;
      this.logger.warn(
        { err },
        'GeoIP database cannot be read; the session location stays empty'
      );
      return null;
    }
  }
}
