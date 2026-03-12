import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { ResourceFormDialogComponent } from './resource-form-dialog.component';
import type { ResourceFormDialogData } from './resource-form-dialog.component';
import type { ResourceResponse } from '@app/shared/types/rbac.types';

const mockResource: ResourceResponse = {
  id: 'res-1',
  name: 'user',
  subject: 'User',
  displayName: 'Users',
  description: 'User management',
  isSystem: true,
  createdAt: '2024-01-01T00:00:00.000Z'
};

describe('ResourceFormDialogComponent', () => {
  let component: ResourceFormDialogComponent;
  let fixture: ComponentFixture<ResourceFormDialogComponent>;
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };

  function createComponent(data: ResourceFormDialogData): void {
    dialogRefMock = { close: vi.fn() };

    TestBed.configureTestingModule({
      imports: [ResourceFormDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MAT_DIALOG_DATA, useValue: data }
      ]
    });

    fixture = TestBed.createComponent(ResourceFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders "Edit Resource" title', () => {
    createComponent({ resource: mockResource });
    const title = fixture.nativeElement.querySelector('[mat-dialog-title]');
    expect(title?.textContent?.trim()).toBe('Edit Resource');
  });

  it('pre-fills form with resource displayName and description', () => {
    createComponent({ resource: mockResource });
    const form = component['form'];
    expect(form.getRawValue().displayName).toBe('Users');
    expect(form.getRawValue().description).toBe('User management');
  });

  it('pre-fills description as empty string when resource description is null', () => {
    createComponent({ resource: { ...mockResource, description: null } });
    const form = component['form'];
    expect(form.getRawValue().description).toBe('');
  });

  it('shows internal name as hint text', () => {
    createComponent({ resource: mockResource });
    const hint = fixture.nativeElement.querySelector('mat-hint');
    expect(hint?.textContent).toContain('user');
  });

  it('disables Save button when form is pristine', () => {
    createComponent({ resource: mockResource });
    const saveBtn = fixture.nativeElement.querySelector(
      'button[color="primary"]'
    );
    expect(saveBtn?.disabled).toBe(true);
  });

  it('enables Save button when form is dirty and valid', () => {
    createComponent({ resource: mockResource });
    component['form'].get('displayName')?.setValue('Updated Name');
    component['form'].markAsDirty();
    fixture.detectChanges();
    const saveBtn = fixture.nativeElement.querySelector(
      'button[color="primary"]'
    );
    expect(saveBtn?.disabled).toBe(false);
  });

  it('disables Save button when displayName is empty (required)', () => {
    createComponent({ resource: mockResource });
    component['form'].get('displayName')?.setValue('');
    component['form'].markAsDirty();
    fixture.detectChanges();
    const saveBtn = fixture.nativeElement.querySelector(
      'button[color="primary"]'
    );
    expect(saveBtn?.disabled).toBe(true);
  });

  it('disables Save button when displayName exceeds 100 chars (maxlength)', () => {
    createComponent({ resource: mockResource });
    component['form'].get('displayName')?.setValue('a'.repeat(101));
    component['form'].markAsDirty();
    fixture.detectChanges();
    const saveBtn = fixture.nativeElement.querySelector(
      'button[color="primary"]'
    );
    expect(saveBtn?.disabled).toBe(true);
  });

  it('calls dialogRef.close with correct result on submit', () => {
    createComponent({ resource: mockResource });
    component['form'].get('displayName')?.setValue('  Updated  ');
    component['form'].get('description')?.setValue('  A desc  ');
    component['form'].markAsDirty();
    fixture.detectChanges();

    component.submit();

    expect(dialogRefMock.close).toHaveBeenCalledWith({
      displayName: 'Updated',
      description: 'A desc'
    });
  });

  it('returns null for description when trimmed value is empty on submit', () => {
    createComponent({ resource: mockResource });
    component['form'].get('displayName')?.setValue('Name');
    component['form'].get('description')?.setValue('   ');
    component['form'].markAsDirty();

    component.submit();

    expect(dialogRefMock.close).toHaveBeenCalledWith({
      displayName: 'Name',
      description: null
    });
  });

  it('calls dialogRef.close with no argument on cancel', () => {
    createComponent({ resource: mockResource });
    component.cancel();
    expect(dialogRefMock.close).toHaveBeenCalledWith();
  });

  it('does not close when form is invalid on submit', () => {
    createComponent({ resource: mockResource });
    component['form'].get('displayName')?.setValue('');
    component['form'].markAsDirty();

    component.submit();

    expect(dialogRefMock.close).not.toHaveBeenCalled();
  });
});
