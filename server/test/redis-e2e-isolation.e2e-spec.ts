import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  DEFAULT_E2E_REDIS_DB,
  readE2eRedisDb,
  readRedisUrl,
  withRedisDatabase
} from './redis-e2e-isolation';

const REDIS_URL = process.env['REDIS_URL'];
const runWithRedis = REDIS_URL ? describe : describe.skip;

function writeEnvFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-redis-'));
  const path = join(dir, '.env');
  writeFileSync(path, contents);
  return path;
}

describe('e2e Redis isolation', () => {
  describe('withRedisDatabase', () => {
    it('pins the URL to the given database', () => {
      expect(withRedisDatabase('redis://localhost:6379', 15)).toBe(
        'redis://localhost:6379/15'
      );
    });

    it('replaces a database the URL already carries', () => {
      expect(withRedisDatabase('redis://localhost:6379/2', 15)).toBe(
        'redis://localhost:6379/15'
      );
    });

    it('preserves scheme, credentials, host and port', () => {
      const isolated = new URL(
        withRedisDatabase('rediss://user:p%40ss@cache.internal:6380', 9)
      );
      expect(isolated.protocol).toBe('rediss:');
      expect(isolated.username).toBe('user');
      expect(isolated.password).toBe('p%40ss');
      expect(isolated.hostname).toBe('cache.internal');
      expect(isolated.port).toBe('6380');
      expect(isolated.pathname).toBe('/9');
    });

    it('refuses database 0 and non-integer indexes', () => {
      expect(() => withRedisDatabase('redis://localhost:6379', 0)).toThrow(
        /integer >= 1/
      );
      expect(() => withRedisDatabase('redis://localhost:6379', -1)).toThrow(
        /integer >= 1/
      );
      expect(() => withRedisDatabase('redis://localhost:6379', 1.5)).toThrow(
        /integer >= 1/
      );
    });
  });

  describe('readE2eRedisDb', () => {
    it('defaults to the dedicated database', () => {
      expect(readE2eRedisDb({})).toBe(DEFAULT_E2E_REDIS_DB);
      expect(readE2eRedisDb({ E2E_REDIS_DB: '' })).toBe(DEFAULT_E2E_REDIS_DB);
    });

    it('honours an override', () => {
      expect(readE2eRedisDb({ E2E_REDIS_DB: '7' })).toBe(7);
    });

    it('refuses to target the shared dev database', () => {
      expect(() => readE2eRedisDb({ E2E_REDIS_DB: '0' })).toThrow(
        /integer >= 1/
      );
      expect(() => readE2eRedisDb({ E2E_REDIS_DB: 'default' })).toThrow(
        /integer >= 1/
      );
    });
  });

  describe('readRedisUrl', () => {
    const envFile = writeEnvFile('REDIS_URL=redis://from-file:6379\n');

    it('prefers an explicit environment value', () => {
      expect(
        readRedisUrl({ REDIS_URL: 'redis://from-env:6379' }, envFile)
      ).toBe('redis://from-env:6379');
    });

    it('treats an empty REDIS_URL as "no Redis", matching CI', () => {
      expect(readRedisUrl({ REDIS_URL: '' }, envFile)).toBeUndefined();
    });

    it('falls back to the .env file the application itself reads', () => {
      expect(readRedisUrl({}, envFile)).toBe('redis://from-file:6379');
    });

    it('returns undefined when neither source has a URL', () => {
      expect(
        readRedisUrl({}, writeEnvFile('DB_HOST=localhost\n'))
      ).toBeUndefined();
      expect(
        readRedisUrl({}, join(tmpdir(), 'missing-e2e-env'))
      ).toBeUndefined();
    });
  });

  runWithRedis('when the run is backed by Redis', () => {
    it('is confined to a dedicated database, never the shared one', () => {
      expect(new URL(REDIS_URL as string).pathname).toBe(
        `/${readE2eRedisDb()}`
      );
    });
  });
});
