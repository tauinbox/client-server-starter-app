import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { FeatureController } from './controllers/feature.controller';
import { FeatureService } from './services/feature.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeatureEntity } from './entities/feature.entity';
import { FeatureLoggingMiddleware } from './middlewares/feature-logging.middleware';
import { FeatureControllerGuard } from './guards/feature-controller.guard';
import { FeatureMethodGuard } from './guards/feature-method.guard';

@Module({
  imports: [TypeOrmModule.forFeature([FeatureEntity])],
  controllers: [FeatureController],
  providers: [FeatureService, FeatureControllerGuard, FeatureMethodGuard],
  exports: [FeatureService],
})
export class FeatureModule implements NestModule {
  // to add middleware our module has to implement NestModule interface

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(FeatureLoggingMiddleware).forRoutes('*'); // configure middleware to match all the routes

    // .forRoutes({ path: '*', method: RequestMethod.ALL }); // another approach to configure it with method
    // or if we want to apply middleware to a specific controller we can use: .forRoutes(FeatureController)
  }
}
