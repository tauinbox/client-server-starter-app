import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { FeatureController } from './controllers/feature.controller';
import { FeatureService } from './services/feature.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeatureEntity } from './entity/feature.entity';
import { LoggingMiddleware } from './middlewares/logging.middleware';

@Module({
  imports: [TypeOrmModule.forFeature([FeatureEntity])],
  controllers: [FeatureController],
  providers: [FeatureService],
  exports: [FeatureService],
})
export class FeatureModule implements NestModule {
  // to add middleware our module has to implement NestModule interface

  configure(consumer: MiddlewareConsumer): any {
    consumer.apply(LoggingMiddleware).forRoutes('*'); // configure middleware to match all the routes
  }
}
