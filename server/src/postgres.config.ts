import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { LoggerOptions } from 'typeorm';

const localConfig: Partial<PostgresConnectionOptions> = {
  host: '',
  port: 5432,
  username: '',
  password: '',
  database: '',
  logging: ['warn', 'error'] as LoggerOptions,
  logger: 'simple-console',
  schema: 'public',
  migrationsRun: false
};

export const postgresConfig: () => PostgresConnectionOptions = () => ({
  type: 'postgres',
  host: process.env['DB_HOST'] || localConfig.host,
  port: process.env['DB_PORT']
    ? Number(process.env['DB_PORT'])
    : localConfig.port,
  username: process.env['DB_USER'] || localConfig.username,
  password: process.env['DB_PASSWORD'] || localConfig.password,
  database: process.env['DB_NAME'] || localConfig.database,
  schema: process.env['DB_SCHEMA'] || localConfig.schema,
  logging: process.env['DB_LOGGING']
    ? isJsonString(process.env['DB_LOGGING'])
      ? (JSON.parse(process.env['DB_LOGGING']) as LoggerOptions)
      : (process.env['DB_LOGGING'] as LoggerOptions)
    : localConfig.logging,
  logger:
    (process.env['DB_LOGGER'] as PostgresConnectionOptions['logger']) ||
    localConfig.logger,
  migrationsRun: false, // automatically run migrations on startup
  synchronize: false, // always false — run 'npm run build && npm run migrations:run' manually
  entities: [__dirname + '/modules/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{ts,.js}'],
  applicationName: 'Starter Project',
  extra: {
    max: process.env['DB_POOL_MAX'] ? Number(process.env['DB_POOL_MAX']) : 10,
    idleTimeoutMillis: process.env['DB_POOL_IDLE_TIMEOUT']
      ? Number(process.env['DB_POOL_IDLE_TIMEOUT'])
      : 30000,
    connectionTimeoutMillis: process.env['DB_POOL_CONNECTION_TIMEOUT']
      ? Number(process.env['DB_POOL_CONNECTION_TIMEOUT'])
      : 5000
  }
});

function isJsonString(str: string) {
  try {
    JSON.parse(str);
  } catch (_e) {
    return false;
  }
  return true;
}
