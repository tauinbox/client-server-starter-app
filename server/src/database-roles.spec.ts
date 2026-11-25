import { getMetadataArgsStorage } from 'typeorm';
import { SETTINGS_ENTITIES } from './data-sources';
import {
  scramVerifier,
  SETTINGS_SCHEMA,
  SOURCE_ROLES,
  sourceLogin
} from './database-roles';
import { loadEntities } from './postgres.config';

describe('database roles', () => {
  describe('scramVerifier', () => {
    // Postgres 18 stored this verifier for `CREATE ROLE ... PASSWORD
    // 'probe-password'`; the same salt gives the same verifier here.
    const SALT = 'BOCsV5hlrp9Q+oiIXt0l7g==';
    const POSTGRES_VERIFIER =
      'SCRAM-SHA-256$4096:BOCsV5hlrp9Q+oiIXt0l7g==$W/xeut8/KbkrDqxH7yPtdsaDYiAedz42f9Qzm9S9aps=:d/mt96gx85n7samWy/HzOnAZFEXLJw35zugVwaVrepA=';

    it('builds the verifier that Postgres stores for the password', () => {
      expect(scramVerifier('probe-password', Buffer.from(SALT, 'base64'))).toBe(
        POSTGRES_VERIFIER
      );
    });

    it('takes a new salt each time and holds no password', () => {
      const [first, second] = [
        scramVerifier('probe-password'),
        scramVerifier('probe-password')
      ];

      expect(first).not.toBe(second);
      expect(first).not.toContain('probe-password');
    });
  });

  describe('sourceLogin', () => {
    it.each(['regional', 'settings'] as const)(
      'logs the %s data source in with its own role',
      (kind) => {
        const { role, passwordKey } = SOURCE_ROLES[kind];

        expect(
          sourceLogin(kind, (key) =>
            key === passwordKey ? 'secret' : undefined
          )
        ).toEqual({ username: role, password: 'secret' });
      }
    );

    it.each([undefined, ''])('refuses a password of %p', (password) => {
      expect(() => sourceLogin('settings', () => password)).toThrow(
        'DB_SETTINGS_PASSWORD must be set: it is the password of the database role app_settings'
      );
    });
  });

  it('puts each settings entity, and no other entity, in the settings schema', () => {
    const entities = loadEntities();
    const schemaOf = new Map(
      getMetadataArgsStorage()
        .tables.filter(({ target }) =>
          entities.includes(target as NewableFunction)
        )
        .map(({ target, schema }) => [target, schema])
    );

    for (const entity of entities) {
      expect({ entity: entity.name, schema: schemaOf.get(entity) }).toEqual({
        entity: entity.name,
        schema: SETTINGS_ENTITIES.includes(entity) ? SETTINGS_SCHEMA : undefined
      });
    }
  });
});
