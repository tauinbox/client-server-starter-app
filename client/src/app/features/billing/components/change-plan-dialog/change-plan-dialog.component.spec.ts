import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, throwError } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type {
  PlanResponse,
  ProrationPreviewResponse,
  SubscriptionResponse
} from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { BillingService } from '../../services/billing.service';
import type { ChangePlanDialogData } from './change-plan-dialog.component';
import { ChangePlanDialogComponent } from './change-plan-dialog.component';

function makePlan(overrides: Partial<PlanResponse>): PlanResponse {
  return {
    id: `plan-${overrides.key}`,
    key: 'pro',
    name: 'Pro',
    description: null,
    billingMode: 'fixed',
    interval: 'month',
    meterKey: null,
    entitlements: [],
    limits: null,
    trialDays: 0,
    active: true,
    prices: {
      yookassa: { currency: 'RUB', amountMinor: 99000 },
      paddle: { currency: 'USD', amountMinor: 1200 }
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

const plans: PlanResponse[] = [
  makePlan({ key: 'free', name: 'Free' }),
  makePlan({ key: 'pro', name: 'Pro' }),
  makePlan({ key: 'business', name: 'Business' }),
  makePlan({
    key: 'usage',
    name: 'Pay as you go',
    billingMode: 'usage',
    meterKey: 'api_calls',
    prices: {
      yookassa: { currency: 'RUB', amountMinor: 0, unitPriceMinor: 200 },
      paddle: { currency: 'USD', amountMinor: 0, unitPriceMinor: 2 }
    }
  })
];

const subscription: SubscriptionResponse = {
  id: 'sub-1',
  customerId: 'cust-1',
  planKey: 'pro',
  provider: 'yookassa',
  billingMode: 'fixed',
  status: 'active',
  lifecycleOwner: 'self',
  currentPeriodStart: '2026-06-01T00:00:00.000Z',
  currentPeriodEnd: '2026-07-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  trialEnd: null,
  paymentMethodId: 'pm-1',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z'
};

const splitPreview: ProrationPreviewResponse = {
  provider: 'yookassa',
  fromPlanKey: 'pro',
  toPlanKey: 'business',
  currency: 'RUB',
  creditMinor: 43000,
  chargeMinor: 129000,
  dueNowMinor: 86000
};

describe('ChangePlanDialogComponent', () => {
  let fixture: ComponentFixture<ChangePlanDialogComponent>;
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };
  let billingMock: { previewChange: ReturnType<typeof vi.fn> };

  function createComponent(data?: Partial<ChangePlanDialogData>): void {
    dialogRefMock = { close: vi.fn() };

    TestBed.configureTestingModule({
      imports: [ChangePlanDialogComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        { provide: MatDialogRef, useValue: dialogRefMock },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            plans,
            subscription,
            currentPlan: plans[1],
            ...data
          } satisfies ChangePlanDialogData
        },
        { provide: BillingService, useValue: billingMock }
      ]
    });

    fixture = TestBed.createComponent(ChangePlanDialogComponent);
    fixture.detectChanges();
  }

  function nativeEl(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function optionButtons(): HTMLButtonElement[] {
    return Array.from(
      nativeEl().querySelectorAll<HTMLButtonElement>('.plan-option')
    );
  }

  function confirmButton(): HTMLButtonElement {
    const buttons = Array.from(
      nativeEl().querySelectorAll<HTMLButtonElement>(
        'mat-dialog-actions button'
      )
    );
    return buttons[buttons.length - 1];
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    billingMock = { previewChange: vi.fn().mockReturnValue(of(splitPreview)) };
  });

  it('lists same-mode targets excluding the current plan', () => {
    createComponent();

    const names = optionButtons().map((btn) =>
      btn.querySelector('.option-name')?.textContent?.trim()
    );
    expect(names).toEqual(['Free', 'Business']);
    expect(billingMock.previewChange).not.toHaveBeenCalled();
    expect(confirmButton().disabled).toBe(true);
  });

  it('renders the split proration ledger after selecting a target', () => {
    createComponent();

    optionButtons()[1].click();
    fixture.detectChanges();

    expect(billingMock.previewChange).toHaveBeenCalledWith('business');
    const ledger = fixture.nativeElement.querySelector('.ledger');
    const credit = ledger.querySelector('.credit').textContent;
    const charge = ledger.querySelector('.charge').textContent;
    const dueNow = ledger.querySelector('.due-now dd').textContent;
    expect(credit).toContain('−');
    expect(credit).toContain('430');
    expect(charge).toContain('+');
    expect(charge).toContain('1,290');
    expect(dueNow).toContain('860');
    expect(confirmButton().disabled).toBe(false);
  });

  it('renders only the net amount for a delegated-provider preview', () => {
    billingMock.previewChange.mockReturnValue(
      of({
        ...splitPreview,
        provider: 'paddle',
        currency: 'USD',
        creditMinor: null,
        chargeMinor: null,
        dueNowMinor: 1700
      } satisfies ProrationPreviewResponse)
    );
    createComponent();

    optionButtons()[1].click();
    fixture.detectChanges();

    const ledger = fixture.nativeElement.querySelector('.ledger');
    expect(ledger.querySelector('.credit')).toBeNull();
    expect(ledger.querySelector('.charge')).toBeNull();
    expect(ledger.querySelector('.due-now dd').textContent).toContain('17');
    expect(
      fixture.nativeElement.querySelector('.proration-note')
    ).not.toBeNull();
  });

  it('presents a negative net as a refund of the absolute amount', () => {
    billingMock.previewChange.mockReturnValue(
      of({
        ...splitPreview,
        toPlanKey: 'free',
        creditMinor: 43000,
        chargeMinor: 0,
        dueNowMinor: -43000
      } satisfies ProrationPreviewResponse)
    );
    createComponent();

    optionButtons()[0].click();
    fixture.detectChanges();

    const dueNow = fixture.nativeElement.querySelector('.due-now dd');
    expect(dueNow.textContent).not.toContain('−');
    expect(dueNow.textContent).toContain('430');
  });

  it('auto-selects the single usage target when switching mode', () => {
    createComponent();

    fixture.componentInstance.setMode('usage');
    fixture.detectChanges();

    expect(billingMock.previewChange).toHaveBeenCalledWith('usage');
    const options = optionButtons();
    expect(options).toHaveLength(1);
    expect(options[0].classList.contains('selected')).toBe(true);
  });

  it('disables confirm and shows an error when the preview fails', () => {
    billingMock.previewChange.mockReturnValue(
      throwError(() => new Error('500'))
    );
    createComponent();

    optionButtons()[1].click();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.proration-error')
    ).not.toBeNull();
    expect(confirmButton().disabled).toBe(true);
  });

  it('shows the trial note for a trialing subscription', () => {
    createComponent({
      subscription: { ...subscription, status: 'trialing' }
    });

    optionButtons()[1].click();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.proration-note')
    ).not.toBeNull();
  });

  it('confirm closes the dialog with the selected plan key', () => {
    createComponent();

    optionButtons()[1].click();
    fixture.detectChanges();
    confirmButton().click();

    expect(dialogRefMock.close).toHaveBeenCalledWith({ planKey: 'business' });
  });
});
