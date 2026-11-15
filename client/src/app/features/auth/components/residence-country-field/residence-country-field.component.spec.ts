import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form, required } from '@angular/forms/signals';
import type { CountryCode } from '@app/shared/constants';
import { provideNoopMaterialAnimations } from '../../../../../test-utils/material-animations';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { ResidenceCountryFieldComponent } from './residence-country-field.component';

@Component({
  imports: [ResidenceCountryFieldComponent],
  template: `<nxs-residence-country-field [field]="residenceForm.country" />`
})
class HostComponent {
  readonly model = signal<{ country: CountryCode | '' }>({ country: 'DE' });
  readonly residenceForm = form(this.model, (path) => {
    required(path.country);
  });
}

describe('ResidenceCountryFieldComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, TranslocoTestingModuleWithLangs],
      providers: [provideNoopMaterialAnimations()]
    }).compileComponents();
  });

  async function render(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(HostComponent);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  // Regression: without `MatPrefix` the form field has no prefix slot and
  // drops the icon from the DOM.
  it('renders the globe icon in the prefix slot of the form field', async () => {
    const element = await render();
    const icon = element.querySelector(
      '.mat-mdc-form-field-icon-prefix mat-icon'
    );

    expect(icon?.textContent?.trim()).toBe('public');
  });

  it('shows the selected country and the hint', async () => {
    const element = await render();

    expect(
      element.querySelector('.mat-mdc-select-value')?.textContent?.trim()
    ).toBe('Germany');
    expect(element.querySelector('mat-hint')?.textContent?.trim()).toBe(
      'It decides where your data is stored'
    );
  });
});
