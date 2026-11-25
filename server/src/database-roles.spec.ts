import { getMetadataArgsStorage } from 'typeorm';
import { SETTINGS_ENTITIES } from './data-sources';
import { SETTINGS_SCHEMA, SOURCE_ROLES, sourceLogin } from './database-roles';
import { loadEntities } from './postgres.config';

describe('database roles', () => {
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
