import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Req,
  UseInterceptors
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';
import type { JwtAuthRequest } from '../../auth/types/auth.request';
import { RequireEntitlement } from '../entitlements/require-entitlement.decorator';
import { BillingUserService } from '../services/billing-user.service';
import { CheckoutRequestDto } from '../dtos/checkout-request.dto';
import { CancelSubscriptionRequestDto } from '../dtos/cancel-subscription-request.dto';
import { ChangeSubscriptionRequestDto } from '../dtos/change-subscription-request.dto';
import { ProrationPreviewResponseDto } from '../dtos/proration-preview-response.dto';
import { RegionRequestDto } from '../dtos/region-request.dto';
import { SubscriptionResponseDto } from '../dtos/subscription-response.dto';
import { InvoiceResponseDto } from '../dtos/invoice-response.dto';
import { PaymentMethodResponseDto } from '../dtos/payment-method-response.dto';
import { CheckoutSessionResponseDto } from '../dtos/checkout-session-response.dto';
import { BillingRegionResponseDto } from '../dtos/billing-region-response.dto';
import { UsageSummaryResponseDto } from '../dtos/usage-summary-response.dto';

@ApiTags('Billing API')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Unauthorized' })
@Controller({
  path: 'billing',
  version: '1'
})
@UseInterceptors(ClassSerializerInterceptor)
export class BillingUserController {
  constructor(private readonly billingUser: BillingUserService) {}

  @Get('subscription')
  @ApiOperation({ summary: "The caller's current subscription, or null." })
  @ApiOkResponse({ type: SubscriptionResponseDto })
  getSubscription(@Req() req: JwtAuthRequest) {
    return this.billingUser.getCurrentSubscription(req.user.userId);
  }

  @Get('invoices')
  @ApiOperation({ summary: "The caller's invoices, newest first." })
  @ApiOkResponse({ type: [InvoiceResponseDto] })
  getInvoices(@Req() req: JwtAuthRequest) {
    return this.billingUser.listInvoices(req.user.userId);
  }

  @Get('usage')
  @ApiOperation({
    summary:
      "The caller's metered usage for the current billing period, or null."
  })
  @ApiOkResponse({ type: UsageSummaryResponseDto })
  getUsage(@Req() req: JwtAuthRequest) {
    return this.billingUser.getUsageSummary(req.user.userId);
  }

  @Get('payment-method')
  @ApiOperation({
    summary: "The caller's default saved payment method, or null."
  })
  @ApiOkResponse({ type: PaymentMethodResponseDto })
  getPaymentMethod(@Req() req: JwtAuthRequest) {
    return this.billingUser.getDefaultPaymentMethod(req.user.userId);
  }

  @Post('payment-method')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Start the payment-method update flow for the current subscription (hosted by the provider).'
  })
  @ApiOkResponse({ type: CheckoutSessionResponseDto })
  updatePaymentMethod(@Req() req: JwtAuthRequest) {
    return this.billingUser.startPaymentMethodUpdate(req.user.userId);
  }

  @Post('checkout')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Start a hosted checkout for a plan on the resolved provider.'
  })
  @ApiOkResponse({ type: CheckoutSessionResponseDto })
  checkout(@Req() req: JwtAuthRequest, @Body() body: CheckoutRequestDto) {
    return this.billingUser.checkout(req.user.userId, body.planKey);
  }

  @Post('subscription/change')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Switch the current subscription to another plan (tier and/or billing mode), instantly with proration.'
  })
  @ApiOkResponse({ type: SubscriptionResponseDto })
  changePlan(
    @Req() req: JwtAuthRequest,
    @Body() body: ChangeSubscriptionRequestDto
  ) {
    return this.billingUser.changePlan(req.user.userId, body.planKey);
  }

  @Post('subscription/change/preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Preview the prorated cost of a plan switch without applying it.'
  })
  @ApiOkResponse({ type: ProrationPreviewResponseDto })
  previewChange(
    @Req() req: JwtAuthRequest,
    @Body() body: ChangeSubscriptionRequestDto
  ) {
    return this.billingUser.previewChange(req.user.userId, body.planKey);
  }

  @Post('subscription/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancel the current subscription (end of period by default).'
  })
  @ApiOkResponse({ type: SubscriptionResponseDto })
  cancel(
    @Req() req: JwtAuthRequest,
    @Body() body: CancelSubscriptionRequestDto
  ) {
    return this.billingUser.cancelSubscription(req.user.userId, body.mode);
  }

  @Get('region')
  @ApiOperation({
    summary:
      'Current billing region (override + detected geo default + effective provider).'
  })
  @ApiOkResponse({ type: BillingRegionResponseDto })
  getRegion(@Req() req: JwtAuthRequest) {
    return this.billingUser.getRegion(req.user.userId);
  }

  @Put('region')
  @ApiOperation({
    summary: 'Set the billing region for the next checkout (auto/ru/world).'
  })
  @ApiOkResponse({ type: BillingRegionResponseDto })
  setRegion(@Req() req: JwtAuthRequest, @Body() body: RegionRequestDto) {
    return this.billingUser.setRegion(req.user.userId, body.region);
  }

  @Get('premium-content')
  @RequireEntitlement('reports')
  @ApiOperation({
    summary:
      'Worked example of entitlement enforcement: requires the "reports" capability (403 otherwise).'
  })
  getPremiumContent() {
    return { available: true };
  }
}
