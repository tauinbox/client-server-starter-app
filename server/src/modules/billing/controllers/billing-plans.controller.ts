import {
  ClassSerializerInterceptor,
  Controller,
  Get,
  UseInterceptors
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { PlanResponseDto } from '../dtos/plan-response.dto';
import { PlanService } from '../services/plan.service';

@ApiTags('Billing API')
@Controller({
  path: 'billing',
  version: '1'
})
@UseInterceptors(ClassSerializerInterceptor)
export class BillingPlansController {
  constructor(private readonly planService: PlanService) {}

  @Get('plans')
  @Public()
  @ApiOperation({
    summary:
      'List active billing plans. Public catalog: each plan carries the price for every configured provider; the client shows the price for the resolved billing region.'
  })
  @ApiOkResponse({ type: [PlanResponseDto] })
  findPlans() {
    return this.planService.findActive();
  }
}
