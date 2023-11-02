import { Test, TestingModule } from '@nestjs/testing';
import { FeatureController } from './feature.controller';
import { FeatureService } from '../services/feature.service';

describe('FeatureController', () => {
  let appController: FeatureController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [FeatureController],
      providers: [FeatureService],
    }).compile();

    appController = app.get<FeatureController>(FeatureController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
