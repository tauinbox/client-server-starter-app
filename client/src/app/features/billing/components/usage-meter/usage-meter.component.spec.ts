import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopMaterialAnimations } from '../../../../../test-utils/material-animations';
import type { UsageSummaryResponse } from '@app/shared/types';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { UsageMeterComponent } from './usage-meter.component';

const baseUsage: UsageSummaryResponse = {
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-07-01T00:00:00.000Z',
  unitsSpent: 1240
};

describe('UsageMeterComponent', () => {
  let fixture: ComponentFixture<UsageMeterComponent>;

  async function setup(usage: UsageSummaryResponse): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [UsageMeterComponent, TranslocoTestingModuleWithLangs],
      providers: [provideNoopMaterialAnimations()]
    }).compileComponents();

    fixture = TestBed.createComponent(UsageMeterComponent);
    fixture.componentRef.setInput('usage', usage);
    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  it('shows the units taken from the credits this month', async () => {
    const el = await setup(baseUsage);

    expect(el.querySelector('.usage-readout .total')?.textContent).toContain(
      '1,240'
    );
    expect(el.querySelector('.readout-caption')?.textContent).toContain(
      'units taken from your credits'
    );
    expect(el.querySelector('.usage-empty')).toBeNull();
  });

  it('shows the empty state when no use took credits this month', async () => {
    const el = await setup({ ...baseUsage, unitsSpent: 0 });

    expect(el.querySelector('.usage-empty')?.textContent).toContain(
      'No usage yet this month.'
    );
    expect(el.querySelector('.usage-readout')).toBeNull();
  });

  it('shows the calendar month', async () => {
    const el = await setup(baseUsage);

    expect(el.querySelector('.usage-period')?.textContent).toMatch(
      /Jun 1, 2026\s+–\s+Jul 1, 2026/
    );
  });
});
