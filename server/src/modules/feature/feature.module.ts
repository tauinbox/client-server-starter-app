import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { FeatureController } from './controllers/feature.controller';
import { FeatureService } from './services/feature.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeatureEntity } from './entities/feature.entity';
import { LoggingMiddleware } from './middlewares/logging.middleware';
import { FeatureGuard } from './guards/feature.guard';

@Module({
  imports: [TypeOrmModule.forFeature([FeatureEntity])],
  controllers: [FeatureController],
  providers: [FeatureService, FeatureGuard],
  exports: [FeatureService],
})
export class FeatureModule implements NestModule {
  // to add middleware our module has to implement NestModule interface

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggingMiddleware).forRoutes('*'); // configure middleware to match all the routes

    // .forRoutes({ path: '*', method: RequestMethod.ALL }); // another approach to configure it with method
    // or if we want to apply middleware to a specific controller we can use: .forRoutes(FeatureController)
  }
}
