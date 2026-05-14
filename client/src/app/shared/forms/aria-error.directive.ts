import type { OnDestroy, OnInit } from '@angular/core';
import { Directive, ElementRef, inject } from '@angular/core';
import { NgControl } from '@angular/forms';
import type { Subscription } from 'rxjs';
import { merge } from 'rxjs';

let nextId = 0;

/**
 * Links a form input to its sibling `<mat-error>` via `aria-describedby` so
 * screen readers programmatically associate validation messages with the
 * field (WCAG 1.3.1 / 3.3.1).
 *
 * Interim helper until `<nxs-form-field>` (UI-10) lands and absorbs this
 * behaviour. Apply to `<input matInput>` / `<textarea matInput>` inside a
 * `<mat-form-field>` that contains a `<mat-error>`.
 */
@Directive({
  selector: 'input[nxsAriaError], textarea[nxsAriaError]',
  standalone: true
})
export class AriaErrorDirective implements OnInit, OnDestroy {
  private readonly host =
    inject<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(ElementRef);
  private readonly ngControl = inject(NgControl, { optional: true });
  private readonly errorId = `nxs-aria-err-${++nextId}`;
  private sub?: Subscription;

  ngOnInit(): void {
    const control = this.ngControl?.control;
    if (!control) {
      return;
    }
    this.sub = merge(control.statusChanges, control.valueChanges).subscribe(
      () => this.update()
    );
    queueMicrotask(() => this.update());
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  private update(): void {
    const input = this.host.nativeElement;
    const control = this.ngControl?.control;
    if (!control) {
      return;
    }
    const showError = control.invalid && (control.touched || control.dirty);
    const errorEl = this.findErrorElement();

    if (showError && errorEl) {
      if (!errorEl.id) {
        errorEl.id = this.errorId;
      }
      this.addDescribedBy(input, errorEl.id);
    } else {
      this.removeDescribedBy(input, this.errorId);
    }
  }

  private findErrorElement(): HTMLElement | null {
    const wrapper = this.host.nativeElement.closest('mat-form-field');
    return wrapper?.querySelector('mat-error') ?? null;
  }

  private addDescribedBy(el: HTMLElement, id: string): void {
    const ids = (el.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .filter(Boolean);
    if (ids.includes(id)) {
      return;
    }
    ids.push(id);
    el.setAttribute('aria-describedby', ids.join(' '));
  }

  private removeDescribedBy(el: HTMLElement, id: string): void {
    const ids = (el.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .filter((existing) => existing && existing !== id);
    if (ids.length === 0) {
      el.removeAttribute('aria-describedby');
    } else {
      el.setAttribute('aria-describedby', ids.join(' '));
    }
  }
}
