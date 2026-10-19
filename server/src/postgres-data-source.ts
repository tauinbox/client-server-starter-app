import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { postgresConfig } from './postgres.config';

dotenv.config();

// The CLI that loads this file calls initialize(); a second call throws.
const postgresDataSource = new DataSource(postgresConfig());

export default postgresDataSource;
