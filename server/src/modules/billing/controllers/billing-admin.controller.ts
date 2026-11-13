import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse
} from '@nestjs/swagger';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import {
  InvoiceCursorQueryDto,
  SubscriptionCursorQueryDto
} from '../dtos/billing-cursor-query.dto';
import { Authorize } from '../../auth/decorators/authorize.decorator';
import { RegisterResource } from '../../auth/decorators/register-resource.decorator';
import { LogAudit } from '../../audit/decorators/log-audit.decorator';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import type { JwtAuthRequest } from '../../auth/types/auth.request';
import { BillingAdminService } from '../services/billing-admin.service';
import { MeteringService } from '../services/metering.service';
import { CancelSubscriptionRequestDto } from '../dtos/cancel-subscription-request.dto';
import { RefundInvoiceRequestDto } from '../dtos/refund-invoice-request.dto';
import { RecordUsageRequestDto } from '../dtos/record-usage-request.dto';
import { SubscriptionResponseDto } from '../dtos/subscription-response.dto';
import { InvoiceResponseDto } from '../dtos/invoice-response.dto';
import { MeteringResponseDto } from '../dtos/metering-response.dto';

@ApiTags('Billing Admin API')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Unauthorized' })
@Controller({
  path: 'admin/billing',
  version: '1'
})
@RegisterResource({
  name: 'billing',
  subject: 'Billing',
  displayName: 'Billing',
  description: 'Billing administration',
  actions: ['search', 'create', 'update', 'refund'],
  conditionalActions: []
})
export class BillingAdminController {
  constructor(
    private readonly billingAdmin: BillingAdminService,
    private readonly metering: MeteringService
  ) {}

  @Get('subscriptions')
  @Authorize(['search', 'Billing'])
  @ApiOperation({
    summary: 'List subscriptions, newest first (cursor-paginated).'
  })
  @ApiOkResponse({ description: 'Cursor-paginated list of subscriptions' })
  listSubscriptions(@Query() query: SubscriptionCursorQueryDto) {
    return this.billingAdmin.listSubscriptions(query);
  }

  @Get('invoices')
  @Authorize(['search', 'Billing'])
  @ApiOperation({ summary: 'List invoices, newest first (cursor-paginated).' })
  @ApiOkResponse({ description: 'Cursor-paginated list of invoices' })
  listInvoices(@Query() query: InvoiceCursorQueryDto) {
    return this.billingAdmin.listInvoices(query);
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(200)
  @Authorize(['update', 'Billing'])
  @LogAudit({
    action: AuditAction.BILLING_SUBSCRIPTION_CANCEL,
    targetType: 'Subscription',
    details: ({ body }) => ({
      mode: (body as CancelSubscriptionRequestDto).mode ?? 'period_end'
    })
  })
  @ApiOperation({
    summary: 'Cancel any subscription (end of period by default).'
  })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: CancelSubscriptionRequestDto })
  @ApiOkResponse({ type: SubscriptionResponseDto })
  @ApiNotFoundResponse({ description: 'Subscription not found' })
  @ApiConflictResponse({
    description:
      'Subscription is already canceled, has no paid period to end, or already has a cancellation scheduled'
  })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelSubscriptionRequestDto
  ) {
    return this.billingAdmin.cancelSubscription(id, body.mode);
  }

  @Post('invoices/:id/refund')
  @HttpCode(200)
  @Authorize(['refund', 'Billing'])
  @LogAudit({
    action: AuditAction.BILLING_INVOICE_REFUND,
    targetType: 'Invoice',
    details: ({ body }) => ({
      amountMinor: (body as RefundInvoiceRequestDto).amountMinor ?? null
    })
  })
  @ApiOperation({
    summary:
      'Refund any paid invoice (full, or a partial amount in minor units).'
  })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: RefundInvoiceRequestDto })
  @ApiOkResponse({ type: InvoiceResponseDto })
  @ApiNotFoundResponse({ description: 'Invoice not found' })
  @ApiConflictResponse({
    description: 'Invoice is not paid, or nothing is left to refund'
  })
  @ApiUnprocessableEntityResponse({
    description: 'Refund amount is outside the remaining refundable total'
  })
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RefundInvoiceRequestDto
  ) {
    return this.billingAdmin.refundInvoice(id, body.amountMinor);
  }

  @Post('webhook-events/:id/replay')
  @HttpCode(200)
  @Authorize(['update', 'Billing'])
  @LogAudit({
    action: AuditAction.BILLING_WEBHOOK_EVENT_REPLAY,
    targetType: 'WebhookEvent',
    details: ({ response }) => ({
      status: (response as { status?: string })?.status ?? null
    })
  })
  @ApiOperation({
    summary:
      'Requeue a dead-lettered webhook delivery for the reconciliation sweep.'
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Webhook event reset to `received`.' })
  @ApiNotFoundResponse({ description: 'Webhook event not found' })
  @ApiConflictResponse({ description: 'Webhook event is not dead-lettered' })
  replayWebhookEvent(@Param('id', ParseUUIDPipe) id: string) {
    return this.billingAdmin.replayWebhookEvent(id);
  }

  @Post('usage')
  @Authorize(['create', 'Billing'])
  @ApiOperation({
    summary:
      'Record a metered use and take its units from the prepaid credit balance of the customer (idempotent).'
  })
  @ApiBody({ type: RecordUsageRequestDto })
  @ApiCreatedResponse({ type: MeteringResponseDto })
  @ApiConflictResponse({
    description:
      'The credit balance does not cover the units, or an idempotency key reused with another body'
  })
  @ApiUnprocessableEntityResponse({
    description: 'Meter not in the meter catalog, or occurredAt in the future'
  })
  recordUsage(@Body() body: RecordUsageRequestDto, @Req() req: JwtAuthRequest) {
    const { customerId, meterKey, quantity, idempotencyKey, occurredAt } = body;

    return this.metering.consume(
      customerId,
      { meterKey, units: quantity, idempotencyKey, occurredAt },
      {
        audit: {
          action: AuditAction.BILLING_USAGE_RECORD,
          actorId: req.user?.userId ?? null,
          actorEmail: req.user?.email ?? null,
          targetType: 'UsageRecord',
          details: { customerId, meterKey, quantity },
          context: extractAuditContext(req)
        }
      }
    );
  }
}
