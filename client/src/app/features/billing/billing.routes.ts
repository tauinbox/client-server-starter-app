import type { Routes } from '@angular/router';
import { authGuard } from '@features/auth/guards/auth.guard';
import { AppRouteSegmentEnum } from '../../app.route-segment.enum';
import { billingAvailableGuard } from './guards/billing-available.guard';
import { BillingStore } from './store/billing.store';

export const billingRoutes: Routes = [
  {
    path: '',
    canActivate: [billingAvailableGuard],
    providers: [BillingStore],
    children: [
      {
        // Public pricing page (anonymous pricing included).
        path: '',
        loadComponent: () =>
          import('./components/pricing-page/pricing-page.component').then(
            (c) => c.PricingPageComponent
          )
      },
      {
        path: AppRouteSegmentEnum.BillingSettings,
        canActivate: [authGuard],
        loadComponent: () =>
          import('./components/billing-settings/billing-settings.component').then(
            (c) => c.BillingSettingsComponent
          )
      },
      {
        path: AppRouteSegmentEnum.BillingSuccess,
        canActivate: [authGuard],
        data: { mode: 'success' },
        loadComponent: () =>
          import('./components/checkout-return/checkout-return.component').then(
            (c) => c.CheckoutReturnComponent
          )
      },
      {
        path: AppRouteSegmentEnum.BillingCancel,
        canActivate: [authGuard],
        data: { mode: 'cancel' },
        loadComponent: () =>
          import('./components/checkout-return/checkout-return.component').then(
            (c) => c.CheckoutReturnComponent
          )
      }
    ]
  }
];
