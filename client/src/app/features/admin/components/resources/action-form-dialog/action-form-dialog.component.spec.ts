import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { ActionFormDialogComponent } from './action-form-dialog.component';
import type { ActionFormDialogData } from './action-form-dialog.component';
import type { ActionResponse } from '@app/shared/types/rbac.types';

const mockAction: ActionResponse = {
  id: 'act-1',
  name: 'read',
  displayName: 'Read',
  description: 'Read access',
  isDefault: true,
  createdAt: '2024-01-01T00:00:00.000Z'
};

describe('ActionFormDialogComponent', () => {
  let component: ActionFormDialogComponent;
  let fixture: ComponentFixture<ActionFormDialogComponent>;
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };

  function createComponent(data: ActionFormDialogData): void {
    dialogRefMock = { close: vi.fn() };

    TestBed.configureTestingModule({
      imports: [ActionFormDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MAT_DIALOG_DATA, useValue: data }
      ]
    });

    fixture = TestBed.createComponent(ActionFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows "Add Action" title in create mode', () => {
    createComponent({});
    const title = fixture.nativeElement.querySelector('[mat-dialog-title]');
    expect(title?.textContent?.trim()).toBe('Add Action');
  });

  it('shows "Edit Action" title in edit mode', () => {
    createComponent({ action: mockAction });
    const title = fixture.nativeElement.querySelector('[mat-dialog-title]');
    expect(title?.textContent?.trim()).toBe('Edit Action');
  });

  it('in edit mode: name field is disabled and pre-filled', () => {
    createComponent({ action: mockAction });
    const nameControl = component['form'].get('name');
    expect(nameControl?.disabled).toBe(true);
    expect(nameControl?.value).toBe('read');
  });

  it('in create mode: name field is enabled', () => {
    createComponent({});
    const nameControl = component['form'].get('name');
    expect(nameControl?.disabled).toBe(false);
  });

  it('in create mode: form fields are empty', () => {
    createComponent({});
    const raw = component['form'].getRawValue();
    expect(raw.name).toBe('');
    expect(raw.displayName).toBe('');
    expect(raw.description).toBe('');
  });

  it('in edit mode: pre-fills all fields', () => {
    createComponent({ action: mockAction });
    const raw = component['form'].getRawValue();
    expect(raw.name).toBe('read');
    expect(raw.displayName).toBe('Read');
    expect(raw.description).toBe('Read access');
  });

  it('validates name pattern — rejects names not matching /^[a-z][a-z0-9_]*$/', () => {
    createComponent({});
    const nameControl = component['form'].get('name');

    nameControl?.setValue('InvalidName');
    expect(nameControl?.errors?.['pattern']).toBeTruthy();

    nameControl?.setValue('1invalid');
    expect(nameControl?.errors?.['pattern']).toBeTruthy();

    nameControl?.setValue('with-dash');
    expect(nameControl?.errors?.['pattern']).toBeTruthy();
  });

  it('validates name pattern — accepts valid names', () => {
    createComponent({});
    const nameControl = component['form'].get('name');

    nameControl?.setValue('read');
    expect(nameControl?.errors?.['pattern']).toBeFalsy();

    nameControl?.setValue('read_all');
    expect(nameControl?.errors?.['pattern']).toBeFalsy();

    nameControl?.setValue('r2d2');
    expect(nameControl?.errors?.['pattern']).toBeFalsy();
  });

  it('disables Save button when form is pristine', () => {
    createComponent({});
    const saveBtn = fixture.nativeElement.querySelector(
      'button[color="primary"]'
    );
    expect(saveBtn?.disabled).toBe(true);
  });

  it('disables Save button when required name field is missing', () => {
    createComponent({});
    component['form'].get('displayName')?.setValue('Some Name');
    component['form'].markAsDirty();
    fixture.detectChanges();
    const saveBtn = fixture.nativeElement.querySelector(
      'button[color="primary"]'
    );
    // name is still empty — form is invalid
    expect(saveBtn?.disabled).toBe(true);
  });

  it('disables Save button when required displayName field is missing', () => {
    createComponent({});
    component['form'].get('name')?.setValue('read');
    component['form'].markAsDirty();
    fixture.detectChanges();
    const saveBtn = fixture.nativeElement.querySelector(
      'button[color="primary"]'
    );
    expect(saveBtn?.disabled).toBe(true);
  });

  it('calls dialogRef.close with correct result on submit in create mode', () => {
    createComponent({});
    component['form'].get('name')?.setValue('publish');
    component['form'].get('displayName')?.setValue('  Publish  ');
    component['form'].get('description')?.setValue('  Publish desc  ');
    component['form'].markAsDirty();

    component.submit();

    expect(dialogRefMock.close).toHaveBeenCalledWith({
      name: 'publish',
      displayName: 'Publish',
      description: 'Publish desc'
    });
  });

  it('calls dialogRef.close with correct result on submit in edit mode', () => {
    createComponent({ action: mockAction });
    component['form'].get('displayName')?.setValue('  Updated Read  ');
    component['form'].get('description')?.setValue('Updated desc');
    component['form'].markAsDirty();

    component.submit();

    expect(dialogRefMock.close).toHaveBeenCalledWith({
      name: 'read',
      displayName: 'Updated Read',
      description: 'Updated desc'
    });
  });

  it('calls dialogRef.close with no argument on cancel', () => {
    createComponent({});
    component.cancel();
    expect(dialogRefMock.close).toHaveBeenCalledWith();
  });

  it('does not close when form is invalid on submit', () => {
    createComponent({});
    component['form'].markAsDirty();

    component.submit();

    expect(dialogRefMock.close).not.toHaveBeenCalled();
  });
});
