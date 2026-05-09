import { Module } from '@nestjs/common';
import { CaptchaService } from './captcha.service';
import { CaptchaRequiredGuard } from './captcha-required.guard';
import { CaptchaController } from './captcha.controller';

@Module({
  controllers: [CaptchaController],
  providers: [CaptchaService, CaptchaRequiredGuard],
  exports: [CaptchaService, CaptchaRequiredGuard]
})
export class CaptchaModule {}
