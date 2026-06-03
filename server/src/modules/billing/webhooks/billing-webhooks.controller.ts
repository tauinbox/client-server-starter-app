import {
  Controller,
  HttpCode,
  Post,
  RawBodyRequest,
  Req
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { WebhookIngestionService } from './webhook-ingestion.service';

/**
 * Provider webhook receivers. @Public() — providers cannot present a JWT; each
 * provider verifies its own authenticity inside verifyAndParseWebhook (Paddle
 * HMAC, YooKassa re-fetch). Signature checks need the unparsed bytes, so these
 * read req.rawBody (enabled by rawBody: true in main.ts) instead of a DTO.
 */
@ApiTags('Billing Webhooks')
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
