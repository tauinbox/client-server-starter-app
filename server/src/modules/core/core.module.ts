import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './configuration';
import { CacheModule } from '@nestjs/cache-manager';
import { FeatureModule } from '../feature/feature.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ormConfig } from '../../orm.config';

@Module({})
export class CoreModule {
  static forRoot(): DynamicModule {
    return {
      module: CoreModule,
      global: true,
      imports: [
        ConfigModule.forRoot({
          load: [configuration],
          isGlobal: true,
        }),
        CacheModule.register({
          isGlobal: true,
        }),
        TypeOrmModule.forRootAsync({ imports: [], useFactory: ormConfig }),
        FeatureModule,
      ],
      providers: [],
    };
  }
}
