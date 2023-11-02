import { Module } from '@nestjs/common';
import { FeatureController } from './controllers/feature.controller';
import { FeatureService } from './services/feature.service';

@Module({
  imports: [],
  controllers: [FeatureController],
  providers: [FeatureService],
})
export class FeatureModule {}
