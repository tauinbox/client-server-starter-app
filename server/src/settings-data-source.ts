import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { settingsMigrationOptions } from './migration-sets';

dotenv.config();

// The CLI data source of the settings database: `migrations:revert:settings`
// and `seed:run`, because the seeders write settings rows only.
const settingsDataSource = new DataSource(settingsMigrationOptions());

export default settingsDataSource;
