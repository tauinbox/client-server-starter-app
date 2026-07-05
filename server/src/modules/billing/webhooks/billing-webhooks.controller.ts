import {
  Controller,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
  UseGuards
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { WebhookIngestionService } from './webhook-ingestion.service';
import { WebhookIpAllowlistGuard } from './webhook-ip-allowlist.guard';

/**
 * Provider webhook receivers. @Public() — providers cannot present a JWT; each
 * provider verifies its own authenticity inside verifyAndParseWebhook (Paddle
 * HMAC, YooKassa re-fetch). Signature checks need the unparsed bytes, so these
 * read req.rawBody (enabled by rawBody: true in main.ts) instead of a DTO.
 *
 * @SkipThrottle() — providers deliver from a few stable egress IPs, so all of
 * a provider's webhooks share one per-IP throttle bucket; a renewal batch
 * above the global limit would get 429'd and delay entitlements until a
 * provider retry. Authenticity is signature/re-fetch based and ingestion is
 * idempotent, so the throttle adds no protection here.
 *
 * WebhookIpAllowlistGuard - with the throttle skipped, the source-IP
 * allowlist is what bounds unauthenticated traffic to these routes (and stops
 * arbitrary hosts from forcing YooKassa re-fetches). Enforced only when
 * BILLING_WEBHOOK_IP_ALLOWLIST is set; see the guard for details.
 */
@ApiTags('Billing Webhooks')
@SkipThrottle()
@UseGuards(WebhookIpAllowlistGuard)
@Controller({ path: 'billing/webhooks', version: '1' })
export class BillingWebhooksController {
  constructor(private readonly ingestion: WebhookIngestionService) {}

  @Post('paddle')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Paddle webhook receiver' })
  async paddle(
    @Req() req: RawBodyRequest<Request>
  ): Promise<{ received: true }> {
    await this.ingestion.ingest('paddle', req.rawBody, req.headers);
    return { received: true };
  }

  @Post('yookassa')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'YooKassa webhook receiver' })
  async yookassa(
    @Req() req: RawBodyRequest<Request>
  ): Promise<{ received: true }> {
    await this.ingestion.ingest('yookassa', req.rawBody, req.headers);
    return { received: true };
  }
}
