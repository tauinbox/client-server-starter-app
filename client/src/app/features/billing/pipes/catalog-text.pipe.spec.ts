import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';
import type { CatalogItem } from '../utils/catalog-text';
import { CatalogTextPipe } from './catalog-text.pipe';

@Component({
  imports: [CatalogTextPipe],
  template: `<span class="name">{{
      item() | catalogText: 'plans' : 'name'
    }}</span
    ><span class="description">{{
      item() | catalogText: 'plans' : 'description'
    }}</span>`
})
class HostComponent {
  readonly item = signal<CatalogItem | null>(null);
}

describe('CatalogTextPipe', () => {
  let transloco: TranslocoService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModuleWithLangs]
    });
    transloco = TestBed.inject(TranslocoService);
    transloco.setTranslation(
      {
        'billing.catalog.plans.pro.name': 'Про',
        'billing.catalog.plans.pro.description': 'Для растущих команд'
      },
      'ru'
    );
    transloco.setActiveLang('en');
  });

  function render(item: CatalogItem | null): {
    name: () => string;
    description: () => string;
    detectChanges: () => void;
  } {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.item.set(item);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      name: () => el.querySelector('.name')?.textContent ?? '',
      description: () => el.querySelector('.description')?.textContent ?? '',
      detectChanges: () => fixture.detectChanges()
    };
  }

  it('prefers the translation over the database text', () => {
    const view = render({
      key: 'pro',
      name: 'Pro (db)',
      description: 'db text'
    });
    expect(view.name()).toBe('Pro');
    expect(view.description()).toBe('For growing teams');
  });

  it('follows the active language', () => {
    const view = render({ key: 'pro', name: 'Pro', description: 'db text' });
    transloco.setActiveLang('ru');
    view.detectChanges();
    expect(view.name()).toBe('Про');
    expect(view.description()).toBe('Для растущих команд');
  });

  it('falls back to the database text for a key with no translation', () => {
    const view = render({
      key: 'team-custom',
      name: 'Team',
      description: null
    });
    expect(view.name()).toBe('Team');
    expect(view.description()).toBe('');
  });

  it('renders nothing for a missing item', () => {
    const view = render(null);
    expect(view.name()).toBe('');
  });
});
