import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { UsageSummaryResponse } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { UsageMeterComponent } from './usage-meter.component';

const baseUsage: UsageSummaryResponse = {
  subscriptionId: 'sub-1',
  meterKey: 'api_calls',
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-07-01T00:00:00.000Z',
  totalUnits: 142,
  includedUnits: 100,
  billableUnits: 42,
  unitPriceMinor: 200,
  amountMinor: 8400,
  currency: 'USD'
};

describe('UsageMeterComponent', () => {
  let fixture: ComponentFixture<UsageMeterComponent>;

  async function setup(usage: UsageSummaryResponse): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [UsageMeterComponent, TranslocoTestingModuleWithLangs],
      providers: [provideNoopAnimations()]
    }).compileComponents();

    fixture = TestBed.createComponent(UsageMeterComponent);
    fixture.componentRef.setInput('usage', usage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the readout, quota gauge with overage and the accrued amount', async () => {
    const el = await setup(baseUsage);

    expect(el.querySelector('.usage-readout .total')?.textContent).toContain(
      '142'
    );
    expect(el.querySelector('.usage-gauge')).not.toBeNull();
    expect(el.querySelector('.segment.overage')).not.toBeNull();
    expect(el.querySelector('.meter-key')?.textContent).toContain('api_calls');
    expect(el.querySelector('.ledger-row.accrued dd')?.textContent).toContain(
      '$84.00'
    );
  });

  it('fills the gauge without an overage segment while under quota', async () => {
    const el = await setup({
      ...baseUsage,
      totalUnits: 60,
      billableUnits: 0,
      amountMinor: 0
    });

    expect(el.querySelector('.usage-gauge')).not.toBeNull();
    expect(el.querySelector('.segment.overage')).toBeNull();
    const included = el.querySelector<HTMLElement>('.segment.included');
    expect(included?.style.width).toBe('60%');
  });

  it('skips the gauge for pure pay-as-you-go plans (no included units)', async () => {
    const el = await setup({
      ...baseUsage,
      includedUnits: 0,
      billableUnits: 142,
      amountMinor: 28400
    });

    expect(el.querySelector('.usage-gauge')).toBeNull();
    expect(el.querySelector('.ledger-row.accrued dd')?.textContent).toContain(
      '$284.00'
    );
  });

  it('renders the empty state with zero usage', async () => {
    const el = await setup({
      ...baseUsage,
      totalUnits: 0,
      billableUnits: 0,
      amountMinor: 0
    });

    expect(el.querySelector('.usage-empty')).not.toBeNull();
    expect(el.querySelector('.usage-readout')).toBeNull();
    expect(el.querySelector('.usage-ledger')).toBeNull();
  });
});
