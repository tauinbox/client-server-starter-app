import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { CreditBalanceResponse } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { CreditsCardComponent } from './credits-card.component';

function makeBalance(balanceUnits: number): CreditBalanceResponse {
  return {
    customerId: 'cust-1',
    balanceUnits,
    updatedAt: '2026-06-01T00:00:00.000Z'
  };
}

describe('CreditsCardComponent', () => {
  let fixture: ComponentFixture<CreditsCardComponent>;

  async function setup(credits: CreditBalanceResponse | null): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [CreditsCardComponent, TranslocoTestingModuleWithLangs],
      providers: [provideNoopAnimations(), provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(CreditsCardComponent);
    fixture.componentRef.setInput('credits', credits);
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('renders a positive balance with locale grouping and a buy action', async () => {
    await setup(makeBalance(1240));

    expect(el().querySelector('.credits-units')?.textContent).toContain(
      '1,240'
    );
    expect(el().querySelector('.credits-hint')).toBeNull();
    expect(el().querySelector('.credits-readout.negative')).toBeNull();
    expect(el().querySelector('.buy-credits-btn')?.textContent).toContain(
      'Buy credits'
    );
  });

  it('renders a never-bought (null) balance as zero with the top-up state', async () => {
    await setup(null);

    expect(el().querySelector('.credits-units')?.textContent?.trim()).toBe('0');
    expect(el().querySelector('.credits-hint')).not.toBeNull();
    expect(el().querySelector('.buy-credits-btn')?.textContent).toContain(
      'Top up'
    );
  });

  it('flags an overdrawn balance and explains that usage is paused', async () => {
    await setup(makeBalance(-200));

    expect(el().querySelector('.credits-units')?.textContent).toContain('-200');
    expect(el().querySelector('.credits-readout.negative')).not.toBeNull();
    expect(el().querySelector('.credits-hint.negative')).not.toBeNull();
    expect(el().querySelector('.buy-credits-btn')?.textContent).toContain(
      'Top up'
    );
  });
});
