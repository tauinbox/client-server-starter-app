import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopMaterialAnimations } from '../../../../../test-utils/material-animations';
import { signal } from '@angular/core';
import type {
  BillingProviderId,
  BillingRegionResponse
} from '@app/shared/types';
import { AuthStore } from '@features/auth/store/auth.store';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { BillingStore } from '../../store/billing.store';
import { RegionControlComponent } from './region-control.component';

function regionView(
  availableProviders: BillingProviderId[] = ['paddle', 'yookassa']
): BillingRegionResponse {
  return {
    region: 'auto',
    detectedProvider: 'paddle',
    effectiveProvider: 'paddle',
    availableProviders
  };
}

describe('RegionControlComponent', () => {
  let fixture: ComponentFixture<RegionControlComponent>;
  let storeMock: {
    region: ReturnType<typeof signal<BillingRegionResponse | null>>;
    working: ReturnType<typeof signal<boolean>>;
    setRegion: ReturnType<typeof vi.fn>;
  };

  async function setup(
    region: BillingRegionResponse | null,
    authenticated = true
  ): Promise<void> {
    storeMock = {
      region: signal<BillingRegionResponse | null>(region),
      working: signal(false),
      setRegion: vi.fn().mockResolvedValue(true)
    };

    await TestBed.configureTestingModule({
      imports: [RegionControlComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopMaterialAnimations(),
        { provide: BillingStore, useValue: storeMock },
        {
          provide: AuthStore,
          useValue: { isAuthenticated: signal(authenticated) }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RegionControlComponent);
    fixture.detectChanges();
  }

  function control(): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(
      '.region-control'
    );
  }

  function checkedRegions(): string[] {
    const checked: HTMLElement[] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.region-control button[aria-checked="true"]'
      )
    );
    return checked.map((button) => button.textContent?.trim() ?? '');
  }

  function regionButton(label: string): HTMLButtonElement {
    const buttons: HTMLButtonElement[] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.region-control button'
      )
    );
    const button = buttons.find((b) => b.textContent?.trim() === label);
    if (!button) throw new Error(`No region button "${label}"`);
    return button;
  }

  it('shows the control when two providers are available', async () => {
    await setup(regionView());
    expect(control()).not.toBeNull();
    expect(checkedRegions()).toEqual(['Auto']);
  });

  it('hides the control when only one provider is available', async () => {
    await setup(regionView(['paddle']));
    expect(control()).toBeNull();
  });

  it('shows the control when the stored region resolves to an unavailable provider', async () => {
    await setup({
      ...regionView(['paddle']),
      region: 'ru',
      effectiveProvider: 'yookassa'
    });
    expect(control()).not.toBeNull();
  });

  it('hides the control until the region is known', async () => {
    await setup(null);
    expect(control()).toBeNull();
  });

  it('hides the control for anonymous visitors', async () => {
    await setup(regionView(), false);
    expect(control()).toBeNull();
  });

  it('returns the toggle to the stored region when the change is refused', async () => {
    await setup(regionView());
    storeMock.setRegion.mockResolvedValue(false);

    regionButton('Russia').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(storeMock.setRegion).toHaveBeenCalledWith('ru');
    expect(checkedRegions()).toEqual(['Auto']);
  });

  it('keeps the chosen region on the toggle when the change succeeds', async () => {
    await setup(regionView());
    storeMock.setRegion.mockImplementation(async () => {
      storeMock.region.set({
        ...regionView(),
        region: 'ru',
        effectiveProvider: 'yookassa'
      });
      return true;
    });

    regionButton('Russia').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(checkedRegions()).toEqual(['Russia']);
  });
});
