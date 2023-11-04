import { Module } from '@nestjs/common';
import { FeatureController } from './controllers/feature.controller';
import { FeatureService } from './services/feature.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeatureEntity } from './entity/feature.entity';

@Module({
  imports: [TypeOrmModule.forFeature([FeatureEntity])],
  controllers: [FeatureController],
  providers: [FeatureService],
  exports: [FeatureService],
})
export class FeatureModule {}
