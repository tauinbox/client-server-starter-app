import { TestBed } from '@angular/core/testing';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import type { BreakpointState } from '@angular/cdk/layout';
import { BehaviorSubject, type Observable } from 'rxjs';

import { LayoutService } from './layout.service';

describe('LayoutService', () => {
  let handsetSubject: BehaviorSubject<BreakpointState>;
  let tabletSubject: BehaviorSubject<BreakpointState>;
  let observeSpy: ReturnType<typeof vi.fn>;

  const stateOf = (matches: boolean): BreakpointState => ({
    matches,
    breakpoints: {}
  });

  beforeEach(() => {
    handsetSubject = new BehaviorSubject<BreakpointState>(stateOf(false));
    tabletSubject = new BehaviorSubject<BreakpointState>(stateOf(false));

    observeSpy = vi.fn(
      (value: string | readonly string[]): Observable<BreakpointState> => {
        const query = Array.isArray(value) ? value[0] : (value as string);
        if (query === Breakpoints.Handset) return handsetSubject.asObservable();
        if (query === Breakpoints.Tablet) return tabletSubject.asObservable();
        return new BehaviorSubject<BreakpointState>(
          stateOf(false)
        ).asObservable();
      }
    );

    TestBed.configureTestingModule({
      providers: [
        {
          provide: BreakpointObserver,
          useValue: { observe: observeSpy }
        }
      ]
    });
  });

  it('should be created', () => {
    const service = TestBed.inject(LayoutService);
    expect(service).toBeTruthy();
  });

  it('should expose isHandset as false by default', () => {
    const service = TestBed.inject(LayoutService);
    expect(service.isHandset()).toBe(false);
  });

  it('should reflect handset matches from BreakpointObserver', () => {
    const service = TestBed.inject(LayoutService);
    expect(service.isHandset()).toBe(false);

    handsetSubject.next(stateOf(true));
    expect(service.isHandset()).toBe(true);

    handsetSubject.next(stateOf(false));
    expect(service.isHandset()).toBe(false);
  });

  it('should reflect tablet matches from BreakpointObserver', () => {
    const service = TestBed.inject(LayoutService);
    expect(service.isTablet()).toBe(false);

    tabletSubject.next(stateOf(true));
    expect(service.isTablet()).toBe(true);
  });

  it('should derive isWeb as !isHandset && !isTablet', () => {
    const service = TestBed.inject(LayoutService);
    expect(service.isWeb()).toBe(true);

    handsetSubject.next(stateOf(true));
    expect(service.isWeb()).toBe(false);

    handsetSubject.next(stateOf(false));
    tabletSubject.next(stateOf(true));
    expect(service.isWeb()).toBe(false);

    tabletSubject.next(stateOf(false));
    expect(service.isWeb()).toBe(true);
  });

  it('should observe Handset and Tablet breakpoints', () => {
    TestBed.inject(LayoutService);
    expect(observeSpy).toHaveBeenCalledWith(Breakpoints.Handset);
    expect(observeSpy).toHaveBeenCalledWith(Breakpoints.Tablet);
  });
});
