import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';
import { ListSkeletonComponent } from './list-skeleton.component';

describe('ListSkeletonComponent', () => {
  let fixture: ComponentFixture<ListSkeletonComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ListSkeletonComponent, TranslocoTestingModuleWithLangs]
    }).compileComponents();

    fixture = TestBed.createComponent(ListSkeletonComponent);
    host = fixture.nativeElement as HTMLElement;
  });

  it('should render five rows of four cells by default', () => {
    fixture.detectChanges();

    const rows = host.querySelectorAll('.skeleton-row');
    expect(rows).toHaveLength(5);
    expect(rows[0].querySelectorAll('.skeleton-cell')).toHaveLength(4);
  });

  it('should render the given rows and cell widths', () => {
    fixture.componentRef.setInput('rows', 3);
    fixture.componentRef.setInput('cells', ['narrow', 'chip']);
    fixture.detectChanges();

    const rows = host.querySelectorAll('.skeleton-row');
    expect(rows).toHaveLength(3);
    const cells = rows[0].querySelectorAll('.skeleton-cell');
    expect(cells[0].classList).toContain('sk-narrow');
    expect(cells[1].classList).toContain('sk-chip');
  });

  it('should announce a busy status with the loading text', () => {
    fixture.detectChanges();

    const status = host.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-busy')).toBe('true');
    expect(status?.textContent).toContain('Loading...');
    expect(
      host.querySelector('.skeleton-row')?.getAttribute('aria-hidden')
    ).toBe('true');
  });
});
