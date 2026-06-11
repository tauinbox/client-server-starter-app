import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { ProductResponse } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { DonationCardComponent } from './donation-card.component';

const donation: ProductResponse = {
  id: 'prod-donation',
  key: 'donation',
  name: 'Donation',
  description: 'Support the project with any amount',
  type: 'custom',
  prices: {
    paddle: { currency: 'USD', minAmountMinor: 100, maxAmountMinor: 50000 }
  },
  grant: null,
  active: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

describe('DonationCardComponent', () => {
  let fixture: ComponentFixture<DonationCardComponent>;
  let component: DonationCardComponent;
  let emitted: { amountMinor: number; note?: string }[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DonationCardComponent, TranslocoTestingModuleWithLangs],
      providers: [provideNoopAnimations()]
    }).compileComponents();

    fixture = TestBed.createComponent(DonationCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('product', donation);
    fixture.componentRef.setInput('provider', 'paddle');
    emitted = [];
    component.donate.subscribe((value) => emitted.push(value));
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function selectCustom(): void {
    const toggles = fixture.nativeElement.querySelectorAll(
      'mat-button-toggle button'
    ) as NodeListOf<HTMLButtonElement>;
    toggles[toggles.length - 1].click();
    fixture.detectChanges();
  }

  function payButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.pay-btn');
  }

  it('derives the quick presets from the configured minimum (3× and 5×)', () => {
    const toggles = Array.from(
      fixture.nativeElement.querySelectorAll('mat-button-toggle')
    ) as HTMLElement[];
    expect(toggles.map((toggle) => toggle.textContent?.trim())).toEqual([
      '$3.00',
      '$5.00',
      'Custom'
    ]);
  });

  it('defaults to the first preset with a live pay button', () => {
    expect(payButton().disabled).toBe(false);
    expect(payButton().textContent).toContain('$3.00');

    payButton().click();
    expect(emitted).toEqual([{ amountMinor: 300, note: undefined }]);
  });

  it('hides the amount field for presets and reveals it for custom', () => {
    expect(fixture.nativeElement.querySelector('.custom-amount')).toBeNull();
    selectCustom();
    expect(
      fixture.nativeElement.querySelector('.custom-amount')
    ).not.toBeNull();
  });

  it('disables pay until a custom amount parses and falls inside the bounds', async () => {
    selectCustom();
    expect(payButton().disabled).toBe(true);

    component.donationModel.set({ amount: 'abc', note: '' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(payButton().disabled).toBe(true);

    // $0.50 is below the $1 minimum.
    component.donationModel.set({ amount: '0.50', note: '' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(payButton().disabled).toBe(true);

    component.donationModel.set({ amount: '15', note: '' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(payButton().disabled).toBe(false);
    expect(payButton().textContent).toContain('$15.00');
  });

  it('emits the custom amount in minor units with the trimmed note', async () => {
    selectCustom();
    component.donationModel.set({ amount: '15', note: '  Keep it up  ' });
    await fixture.whenStable();
    fixture.detectChanges();

    payButton().click();
    expect(emitted).toEqual([{ amountMinor: 1500, note: 'Keep it up' }]);
  });

  it('accepts a comma decimal separator (RU input habit)', async () => {
    selectCustom();
    component.donationModel.set({ amount: '12,34', note: '' });
    await fixture.whenStable();
    fixture.detectChanges();

    payButton().click();
    expect(emitted).toEqual([{ amountMinor: 1234, note: undefined }]);
  });
});
