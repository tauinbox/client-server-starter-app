import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import type { InvoiceResponse, SubscriptionResponse } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { LayoutService } from '@core/services/layout.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { AdaptiveDialogService } from '@shared/services/adaptive-dialog.service';
import { BillingAdminStore } from '../../store/billing-admin.store';
import { BillingAdminListComponent } from './billing-admin-list.component';

const activeSub: SubscriptionResponse = {
  id: 'sub-1',
  customerId: 'cust-1',
  planKey: 'pro',
  provider: 'paddle',
  billingMode: 'fixed',
  status: 'active',
  lifecycleOwner: 'provider',
  currentPeriodStart: '2026-06-01T00:00:00.000Z',
  currentPeriodEnd: '2026-07-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  trialEnd: null,
  paymentMethodId: 'pm-1',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z'
};

const paidInvoice: InvoiceResponse = {
  id: 'inv-1',
  customerId: 'cust-1',
  subscriptionId: 'sub-1',
  provider: 'yookassa',
  providerInvoiceRef: 'in_abcdef123456',
  amountMinor: 99000,
  currency: 'RUB',
  status: 'paid',
  billingMode: 'fixed',
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-07-01T00:00:00.000Z',
  paidAt: '2026-06-01T00:00:00.000Z',
  receiptRef: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z'
};

describe('BillingAdminListComponent', () => {
  let storeMock: {
    loading: ReturnType<typeof signal<boolean>>;
    subscriptions: ReturnType<typeof signal<SubscriptionResponse[]>>;
    invoices: ReturnType<typeof signal<InvoiceResponse[]>>;
    load: ReturnType<typeof vi.fn>;
    cancelSubscription: ReturnType<typeof vi.fn>;
    refundInvoice: ReturnType<typeof vi.fn>;
  };
  let confirmSpy: ReturnType<typeof vi.fn>;
  let layoutHandset: ReturnType<typeof signal<boolean>>;
  let hasPermissions: ReturnType<typeof vi.fn>;

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [BillingAdminListComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        { provide: BillingAdminStore, useValue: storeMock },
        {
          provide: AdaptiveDialogService,
          useValue: { openConfirm: confirmSpy }
        },
        {
          provide: LayoutService,
          useValue: {
            isHandset: layoutHandset,
            isTablet: signal(false),
            isWeb: signal(true)
          }
        },
        { provide: AuthStore, useValue: { hasPermissions } }
      ]
    }).compileComponents();
    return TestBed.createComponent(BillingAdminListComponent);
  }

  beforeEach(() => {
    storeMock = {
      loading: signal(false),
      subscriptions: signal([activeSub]),
      invoices: signal([paidInvoice]),
      load: vi.fn(),
      cancelSubscription: vi.fn().mockResolvedValue(true),
      refundInvoice: vi.fn().mockResolvedValue(true)
    };
    confirmSpy = vi.fn().mockReturnValue(of(true));
    layoutHandset = signal(false);
    hasPermissions = vi.fn().mockReturnValue(true);
  });

  it('loads billing data on init', async () => {
    const fixture = await setup();
    fixture.detectChanges();
    expect(storeMock.load).toHaveBeenCalled();
  });

  it('renders desktop tables with one row each', async () => {
    const fixture = await setup();
    fixture.detectChanges();
    const tables = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'table'
    );
    expect(tables.length).toBe(2);
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'table tbody tr'
    );
    expect(rows.length).toBe(2);
    expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain(
      'pro'
    );
  });

  it('switches to card lists on handset', async () => {
    layoutHandset.set(true);
    const fixture = await setup();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('table').length
    ).toBe(0);
    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.record-card')
        .length
    ).toBe(2);
  });

  it('confirmCancel cancels with the chosen mode when confirmed', async () => {
    const fixture = await setup();
    fixture.detectChanges();
    fixture.componentInstance.confirmCancel(activeSub, 'immediate');
    expect(confirmSpy).toHaveBeenCalled();
    expect(storeMock.cancelSubscription).toHaveBeenCalledWith(
      'sub-1',
      'immediate'
    );
  });

  it('does not cancel when the dialog is dismissed', async () => {
    confirmSpy.mockReturnValue(of(false));
    const fixture = await setup();
    fixture.detectChanges();
    fixture.componentInstance.confirmCancel(activeSub, 'period_end');
    expect(storeMock.cancelSubscription).not.toHaveBeenCalled();
  });

  it('confirmRefund refunds the invoice when confirmed', async () => {
    const fixture = await setup();
    fixture.detectChanges();
    fixture.componentInstance.confirmRefund(paidInvoice);
    expect(storeMock.refundInvoice).toHaveBeenCalledWith('inv-1');
  });

  it('hides action buttons without the manage permission', async () => {
    hasPermissions.mockReturnValue(false);
    const fixture = await setup();
    fixture.detectChanges();
    const actionButtons = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll('button[mat-icon-button], button[matIconButton]');
    expect(actionButtons.length).toBe(0);
  });

  it('exposes canCancel/canRefund guards matching server rules', async () => {
    const fixture = await setup();
    const cmp = fixture.componentInstance;
    expect(cmp.canCancel(activeSub)).toBe(true);
    expect(cmp.canCancel({ ...activeSub, status: 'canceled' })).toBe(false);
    expect(cmp.canRefund(paidInvoice)).toBe(true);
    expect(cmp.canRefund({ ...paidInvoice, status: 'refunded' })).toBe(false);
  });
});
