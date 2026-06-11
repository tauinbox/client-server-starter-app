import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { ProductResponse } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { ProductCardComponent } from './product-card.component';

const reportPack: ProductResponse = {
  id: 'prod-report-pack',
  key: 'report-pack',
  name: 'Report pack',
  description: '30 days of reports access without a subscription',
  type: 'sku',
  prices: { paddle: { currency: 'USD', amountMinor: 500 } },
  grant: { entitlement: 'reports', durationDays: 30 },
  active: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

describe('ProductCardComponent', () => {
  let fixture: ComponentFixture<ProductCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductCardComponent, TranslocoTestingModuleWithLangs],
      providers: [provideNoopAnimations()]
    }).compileComponents();

    fixture = TestBed.createComponent(ProductCardComponent);
    fixture.componentRef.setInput('product', reportPack);
    fixture.componentRef.setInput('price', '$5.00');
    fixture.detectChanges();
  });

  it('renders the name, price and the unlocked entitlement with its duration', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Report pack');
    expect(text).toContain('$5.00');
    expect(text).toContain('Reports');
    expect(text).toContain('30');
  });

  it('emits buy with the product key', () => {
    const emitted: string[] = [];
    fixture.componentInstance.buy.subscribe((key) => emitted.push(key));

    (
      fixture.nativeElement.querySelector('.buy-btn') as HTMLButtonElement
    ).click();
    expect(emitted).toEqual(['report-pack']);
  });

  it('disables the buy button while the store is working', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('.buy-btn') as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });
});
