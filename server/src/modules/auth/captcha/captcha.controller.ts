import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator';
import { CaptchaService } from './captcha.service';
import type { CaptchaConfigResponse } from '@app/shared/types';

@ApiTags('Auth API')
@Controller({
  path: 'auth/captcha-config',
  version: '1'
})
export class CaptchaController {
  constructor(private readonly captchaService: CaptchaService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Get public captcha configuration (site key, enabled flag)'
  })
  @ApiOkResponse({ description: 'Captcha public configuration' })
  getConfig(): CaptchaConfigResponse {
    return {
      enabled: this.captchaService.isEnabled(),
      provider: 'turnstile',
      siteKey: this.captchaService.getSiteKey()
    };
  }
}
