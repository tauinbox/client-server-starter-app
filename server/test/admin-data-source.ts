import { DataSource } from 'typeorm';
import { postgresConfig } from '../src/postgres.config';

/**
 * Runs `run` on a connection of the administrator of the e2e database. The
 * data sources of the app log in with roles that cannot change the schema, so
 * a test that creates a trigger, a schema or a probe table, or that turns the
 * triggers off as a restore does, uses this connection.
 */
export async function withAdminDataSource<T>(
  run: (admin: DataSource) => Promise<T>
): Promise<T> {
  const admin = new DataSource({
    ...postgresConfig(),
    entities: [],
    migrations: [],
    logging: false
  });

  await admin.initialize();

  try {
    return await run(admin);
  } finally {
    await admin.destroy();
  }
}
