import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { postgresConfig } from './postgres.config';

dotenv.config();

const postgresDataSource = new DataSource(postgresConfig());

postgresDataSource
  .initialize()
  .then(() => {
    console.log('Data Source has been initialized!');
  })
  .catch((err) => {
    console.error('Error during Data Source initialization', err);
  });

export default postgresDataSource;
