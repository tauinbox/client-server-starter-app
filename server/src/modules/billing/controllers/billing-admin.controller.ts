import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseInterceptors
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { Authorize } from '../../auth/decorators/authorize.decorator';
import { RegisterResource } from '../../auth/decorators/register-resource.decorator';
import { LogAudit } from '../../audit/decorators/log-audit.decorator';
import { BillingAdminService } from '../services/billing-admin.service';
import { CancelSubscriptionRequestDto } from '../dtos/cancel-subscription-request.dto';
import { RefundInvoiceRequestDto } from '../dtos/refund-invoice-request.dto';
import { SubscriptionResponseDto } from '../dtos/subscription-response.dto';
import { InvoiceResponseDto } from '../dtos/invoice-response.dto';

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
  displayName: 'Billing'
})
@UseInterceptors(ClassSerializerInterceptor)
export class BillingAdminController {
  constructor(private readonly billingAdmin: BillingAdminService) {}

  @Get('subscriptions')
  @Authorize(['manage', 'Billing'])
  @ApiOperation({ summary: 'List all subscriptions, newest first.' })
  @ApiOkResponse({ type: [SubscriptionResponseDto] })
  listSubscriptions() {
    return this.billingAdmin.listSubscriptions();
  }

  @Get('invoices')
  @Authorize(['manage', 'Billing'])
  @ApiOperation({ summary: 'List all invoices, newest first.' })
  @ApiOkResponse({ type: [InvoiceResponseDto] })
  listInvoices() {
    return this.billingAdmin.listInvoices();
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(200)
  @Authorize(['manage', 'Billing'])
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
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelSubscriptionRequestDto
  ) {
    return this.billingAdmin.cancelSubscription(id, body.mode);
  }

  @Post('invoices/:id/refund')
  @HttpCode(200)
  @Authorize(['manage', 'Billing'])
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
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RefundInvoiceRequestDto
  ) {
    return this.billingAdmin.refundInvoice(id, body.amountMinor);
  }
}
