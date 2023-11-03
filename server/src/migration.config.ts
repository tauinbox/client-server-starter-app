import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { ormConfig } from './orm.config';

dotenv.config();

const datasource = new DataSource(ormConfig());
datasource.initialize();
export default datasource;
