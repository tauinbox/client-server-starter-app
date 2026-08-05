import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { assertDatabaseReachable, resolveE2eEnv } from './db-e2e-config';

function writeEnvFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-db-'));
  const path = join(dir, '.env');
  writeFileSync(path, contents);
  return path;
}

describe('e2e database configuration', () => {
  describe('resolveE2eEnv', () => {
    const envFile = writeEnvFile(
      [
        'DB_HOST=file-host',
        'DB_PORT=5432',
        'DB_NAME=file-db',
        'DB_USER=file-user',
        'DB_PASSWORD=file-password',
        'SMTP_HOST=file-smtp',
        'JWT_SECRET=not-an-e2e-key'
      ].join('\n')
    );

    it('prefers an explicit environment value', () => {
      const resolved = resolveE2eEnv({ DB_HOST: 'env-host' }, envFile);

      expect(resolved['DB_HOST']).toBe('env-host');
    });

    it('fills the keys the environment leaves out', () => {
      const resolved = resolveE2eEnv({ DB_HOST: 'env-host' }, envFile);

      expect(resolved['DB_USER']).toBe('file-user');
      expect(resolved['DB_PASSWORD']).toBe('file-password');
      expect(resolved['DB_NAME']).toBe('file-db');
    });

    it('lets an explicit empty value win over the file', () => {
      const resolved = resolveE2eEnv({ DB_HOST: '' }, envFile);

      expect(resolved['DB_HOST']).toBe('');
      expect(resolved['DB_PASSWORD']).toBe('file-password');
    });

    it('carries the mail settings the delivery suite gates on', () => {
      expect(resolveE2eEnv({}, envFile)['SMTP_HOST']).toBe('file-smtp');
      expect(resolveE2eEnv({ SMTP_HOST: '' }, envFile)['SMTP_HOST']).toBe('');
    });

    it('takes nothing else from the file', () => {
      expect(resolveE2eEnv({}, envFile)['JWT_SECRET']).toBeUndefined();
    });

    it('tolerates a missing file, leaving the environment as it is', () => {
      const resolved = resolveE2eEnv(
        { DB_HOST: 'env-host' },
        join(tmpdir(), 'missing-e2e-env')
      );

      expect(resolved).toEqual({ DB_HOST: 'env-host' });
    });
  });

  describe('assertDatabaseReachable', () => {
    it('names the database and how to start it when nothing answers', async () => {
      await expect(
        assertDatabaseReachable({
          DB_HOST: '127.0.0.1',
          DB_PORT: '1',
          DB_NAME: 'nope',
          DB_USER: 'postgres',
          DB_PASSWORD: 'postgres'
        })
      ).rejects.toThrow(/127\.0\.0\.1:1\/nope.*ECONNREFUSED.*migrations:run/s);
    });
  });
});
