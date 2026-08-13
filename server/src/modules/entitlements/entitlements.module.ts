import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../billing/entities/customer.entity';
import { CustomerGrant } from '../billing/entities/customer-grant.entity';
import { Plan } from '../billing/entities/plan.entity';
import { Subscription } from '../billing/entities/subscription.entity';
import { EntitlementService } from './entitlement.service';
import { EntitlementGuard } from './entitlement.guard';

/**
 * The resolver lives in its own module because it has no auth dependency —
 * four billing repositories, the cache and metrics — while `BillingModule`
 * imports `AuthModule` for `@Authorize`. Keeping the resolver inside billing
 * meant nothing in auth could read an entitlement without closing a cycle,
 * which is what kept the plan-driven session limit from existing.
 *
 * `BillingModule` re-exports this module, so every existing consumer keeps
 * importing `BillingModule` and injecting `EntitlementService` unchanged.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, CustomerGrant, Plan, Subscription])
  ],
  providers: [EntitlementService, EntitlementGuard],
  exports: [EntitlementService, EntitlementGuard]
})
export class EntitlementsModule {}
