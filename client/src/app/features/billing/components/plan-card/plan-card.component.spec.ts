import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { PlanResponse } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { PlanCardComponent } from './plan-card.component';

const plan: PlanResponse = {
  id: 'plan-pro',
  key: 'pro',
  name: 'Pro',
  description: 'For growing teams',
  billingMode: 'fixed',
  interval: 'month',
  meterKey: null,
  entitlements: ['reports', 'api-access'],
  limits: null,
  trialDays: 0,
  active: true,
  prices: { paddle: { currency: 'USD', amountMinor: 1200 } },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

describe('PlanCardComponent', () => {
  let fixture: ComponentFixture<PlanCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanCardComponent, TranslocoTestingModuleWithLangs],
      providers: [provideNoopAnimations()]
    }).compileComponents();

    fixture = TestBed.createComponent(PlanCardComponent);
    fixture.componentRef.setInput('plan', plan);
    fixture.componentRef.setInput('price', '$12.00');
  });

  it('renders the plan name, price and entitlements', () => {
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Pro');
    expect(text).toContain('$12.00');
    expect(text).toContain('Reports');
    expect(text).toContain('API access');
  });

  it('shows the "Most popular" chip and the choose button when featured', () => {
    fixture.componentRef.setInput('featured', true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.popular-chip')).not.toBeNull();
    expect(el.querySelector('button')).not.toBeNull();
  });

  it('shows a current badge instead of the button when current', () => {
    fixture.componentRef.setInput('current', true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.current-badge')).not.toBeNull();
    expect(el.querySelector('button')).toBeNull();
  });

  it('emits choose with the plan key on click', () => {
    const choose = vi.fn();
    fixture.componentInstance.choose.subscribe(choose);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button').click();
    expect(choose).toHaveBeenCalledWith('pro');
  });
});
