/**
 * Creates the settings database of `SETTINGS_DB_NAME` when it does not exist,
 * for a test run that keeps the settings in a database of their own. It does
 * nothing when the settings use the regional database, which is the layout of
 * production in stage 1.
 *
 * Usage (from server/): npm run db:create-settings
 */

import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { postgresConfig, settingsConnection } from '../src/postgres.config';

dotenv.config();

async function main(): Promise<void> {
  const regional = postgresConfig();
  const settings = settingsConnection();

  if (
    settings.host === regional.host &&
    settings.port === regional.port &&
    settings.database === regional.database
  ) {
    console.log('The settings use the regional database: nothing to create');

    return;
  }

  const name = settings.database ?? '';
  const admin = new DataSource({
    type: 'postgres',
    ...settings,
    database: 'postgres',
    logging: false
  });

  await admin.initialize();

  try {
    const found = await admin.query<unknown[]>(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name]
    );

    if (found.length > 0) {
      console.log(`The settings database ${name} exists`);

      return;
    }

    // An identifier cannot be a parameter; the double quotes are escaped.
    await admin.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
    console.log(`Created the settings database ${name}`);
  } finally {
    await admin.destroy();
  }
}

main().catch((error: unknown) => {
  console.error('Creating the settings database failed:', error);
  process.exit(1);
});
