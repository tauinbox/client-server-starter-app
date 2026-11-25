import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { settingsMigrationOptions } from './migration-sets';

dotenv.config();

// The TypeORM CLI data source of the settings set (`migrations:revert:settings`).
const settingsDataSource = new DataSource(settingsMigrationOptions());

export default settingsDataSource;
