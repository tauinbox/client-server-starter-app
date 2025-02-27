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
  migrationsRun: false,
};

export const postgresConfig: () => PostgresConnectionOptions = () => ({
  type: 'postgres',
  host: process.env.DB_HOST || localConfig.host,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : localConfig.port,
  username: process.env.DB_USER || localConfig.username,
  password: process.env.DB_PASSWORD || localConfig.password,
  database: process.env.DB_NAME || localConfig.database,
  schema: process.env.DB_SCHEMA || localConfig.schema,
  logging: process.env.DB_LOGGING
    ? isJsonString(process.env.DB_LOGGING)
      ? (JSON.parse(process.env.DB_LOGGING) as LoggerOptions)
      : (process.env.DB_LOGGING as LoggerOptions)
    : localConfig.logging,
  logger: (process.env.DB_LOGGER as any) || localConfig.logger,
  migrationsRun: false, // automatically run migrations on startup
  synchronize: process.env.ENVIRONMENT === 'local', // should be false for production
  entities: [__dirname + '/modules/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{ts,.js}'],
  applicationName: 'Starter Project',
});

function isJsonString(str: string) {
  try {
    JSON.parse(str);
  } catch (e) {
    return false;
  }
  return true;
}
