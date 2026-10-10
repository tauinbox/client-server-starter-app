import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';
import { ListEmptyComponent } from './list-empty.component';

describe('ListEmptyComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ListEmptyComponent, TranslocoTestingModuleWithLangs]
    });
  });

  async function render(filtered?: boolean): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(ListEmptyComponent);
    fixture.componentRef.setInput('icon', 'shield');
    fixture.componentRef.setInput('message', 'No roles yet.');
    if (filtered !== undefined) {
      fixture.componentRef.setInput('filtered', filtered);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the icon and the message when no filter is active', async () => {
    const host = await render();

    const icon = host.querySelector('mat-icon');
    expect(icon?.textContent?.trim()).toBe('shield');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('.empty-message')?.textContent?.trim()).toBe(
      'No roles yet.'
    );
  });

  it('says that no row matches when a filter is active', async () => {
    const host = await render(true);

    expect(host.querySelector('.empty-message')?.textContent?.trim()).toBe(
      'Nothing matches these filters.'
    );
  });
});
