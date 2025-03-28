import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './configuration';
import { CacheModule } from '@nestjs/cache-manager';
import { FeatureModule } from '../feature/feature.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { postgresConfig } from '../../postgres.config';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({})
export class CoreModule {
  static forRoot(): DynamicModule {
    return {
      module: CoreModule,
      global: true,
      imports: [
        ConfigModule.forRoot({
          load: [configuration],
          isGlobal: true
        }),
        CacheModule.register({
          isGlobal: true
        }),
        ScheduleModule.forRoot(),
        TypeOrmModule.forRootAsync({ imports: [], useFactory: postgresConfig }),
        AuthModule,
        UsersModule,
        FeatureModule
      ],
      providers: []
    };
  }
}
