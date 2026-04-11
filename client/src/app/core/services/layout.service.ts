import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { map } from 'rxjs';

/**
 * Single source of truth for responsive breakpoints across the client.
 *
 * Components and services should prefer these signals over hand-rolled
 * `BreakpointObserver` wiring or hard-coded media queries, so layout
 * decisions stay consistent and test-friendly.
 */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  readonly #breakpointObserver = inject(BreakpointObserver);

  readonly isHandset = toSignal(
    this.#breakpointObserver
      .observe(Breakpoints.Handset)
      .pipe(map((r) => r.matches)),
    { initialValue: false }
  );

  readonly isTablet = toSignal(
    this.#breakpointObserver
      .observe(Breakpoints.Tablet)
      .pipe(map((r) => r.matches)),
    { initialValue: false }
  );

  readonly isWeb = computed(() => !this.isHandset() && !this.isTablet());
}
