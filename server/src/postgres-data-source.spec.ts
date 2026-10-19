import { DataSource } from 'typeorm';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('./postgres.config', () => ({
  postgresConfig: () => ({ type: 'postgres' })
}));

/**
 * The TypeORM CLI (`migrations:*`, and `server/docker-entrypoint.sh` on every
 * deploy) and the seeding CLI call initialize() on this data source.
 * TypeORM 1 refuses a second call with CannotConnectAlreadyConnectedError, so
 * the module must not call it when it is loaded.
 */
describe('postgresDataSource', () => {
  it('does not call initialize() when the module is loaded', async () => {
    const initialize = jest
      .spyOn(DataSource.prototype, 'initialize')
      .mockImplementation(function (this: DataSource) {
        return Promise.resolve(this);
      });

    const { default: dataSource } = await import('./postgres-data-source');

    expect(dataSource).toBeInstanceOf(DataSource);
    expect(initialize).not.toHaveBeenCalled();
    initialize.mockRestore();
  });
});
