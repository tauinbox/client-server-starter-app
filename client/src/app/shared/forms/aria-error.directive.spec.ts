import { Component, ViewChild } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { describe, expect, it, beforeEach } from 'vitest';

import { AriaErrorDirective } from './aria-error.directive';

@Component({
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    AriaErrorDirective
  ],
  template: `
    <mat-form-field>
      <mat-label>Email</mat-label>
      <input matInput nxsAriaError [formControl]="control" type="email" />
      @if (control.invalid && control.touched) {
        <mat-error>Email is required</mat-error>
      }
    </mat-form-field>
  `
})
class HostComponent {
  readonly control = new FormControl('', [Validators.required]);
  @ViewChild(AriaErrorDirective) directive!: AriaErrorDirective;
}

describe('AriaErrorDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideNoopAnimations()]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function input(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input');
  }

  function errorEl(): HTMLElement | null {
    return fixture.nativeElement.querySelector('mat-error');
  }

  it('does not set aria-describedby while control is untouched', () => {
    const described = input().getAttribute('aria-describedby') ?? '';
    expect(described).not.toMatch(/nxs-aria-err-/);
  });

  it('links input to mat-error when control is invalid + touched', async () => {
    host.control.markAsTouched();
    host.control.updateValueAndValidity();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const error = errorEl();
    expect(error).not.toBeNull();
    expect(error!.id).toBeTruthy();
    expect(input().getAttribute('aria-describedby')).toContain(error!.id);
  });

  it('removes the linkage once the control becomes valid', async () => {
    host.control.markAsTouched();
    host.control.updateValueAndValidity();
    fixture.detectChanges();
    await fixture.whenStable();

    host.control.setValue('user@example.com');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const described = input().getAttribute('aria-describedby') ?? '';
    expect(described).not.toMatch(/nxs-aria-err-/);
  });

  it('keeps the linkage stable across multiple status updates', async () => {
    host.control.markAsTouched();
    host.control.updateValueAndValidity();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const firstId = errorEl()?.id;
    expect(firstId).toBeTruthy();

    host.control.updateValueAndValidity();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(errorEl()?.id).toBe(firstId);
    expect(input().getAttribute('aria-describedby')).toContain(firstId!);
  });
});
