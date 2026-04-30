import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslocoTestingModuleWithLangs } from '../../../../../../test-utils/transloco-testing';

import { ActionFormDialogComponent } from './action-form-dialog.component';
import type { ActionFormDialogData } from './action-form-dialog.component';
import { ResourcesStore } from '../../../store/resources.store';
import type {
  ActionResponse,
  ResourceResponse
} from '@app/shared/types/rbac.types';

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
  let resourcesStoreMock: {
    resources: ReturnType<typeof signal<ResourceResponse[]>>;
    actions: ReturnType<typeof signal<ActionResponse[]>>;
    loading: ReturnType<typeof signal<boolean>>;
    load: ReturnType<typeof vi.fn>;
    createAction: ReturnType<typeof vi.fn>;
    updateAction: ReturnType<typeof vi.fn>;
  };
  let snackBarMock: { open: ReturnType<typeof vi.fn> };

  function createComponent(data: ActionFormDialogData): void {
    dialogRefMock = { close: vi.fn() };

    TestBed.configureTestingModule({
      imports: [ActionFormDialogComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: ResourcesStore, useValue: resourcesStoreMock },
        { provide: MatSnackBar, useValue: snackBarMock }
      ]
    });

    fixture = TestBed.createComponent(ActionFormDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    resourcesStoreMock = {
      resources: signal([]),
      actions: signal([mockAction]),
      loading: signal(false),
      load: vi.fn(),
      createAction: vi.fn().mockReturnValue(of(mockAction)),
      updateAction: vi.fn().mockReturnValue(of(mockAction))
    };
    snackBarMock = { open: vi.fn() };
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

  it('in edit mode: name field is pre-filled', () => {
    createComponent({ action: mockAction });
    expect(component.actionModel().name).toBe('read');
  });

  it('in create mode: model fields are empty', () => {
    createComponent({});
    const model = component.actionModel();
    expect(model.name).toBe('');
    expect(model.displayName).toBe('');
    expect(model.description).toBe('');
  });

  it('in edit mode: pre-fills all fields', () => {
    createComponent({ action: mockAction });
    const model = component.actionModel();
    expect(model.name).toBe('read');
    expect(model.displayName).toBe('Read');
    expect(model.description).toBe('Read access');
  });

  it('validates name pattern — rejects names not matching /^[a-z][a-z0-9_]*$/', () => {
    createComponent({});

    component.actionModel.set({
      name: 'InvalidName',
      displayName: 'Test',
      description: ''
    });
    TestBed.tick();
    let errors = component.actionForm.name().errors();
    expect(errors.some((e) => e.kind === 'pattern')).toBe(true);

    component.actionModel.set({
      name: '1invalid',
      displayName: 'Test',
      description: ''
    });
    TestBed.tick();
    errors = component.actionForm.name().errors();
    expect(errors.some((e) => e.kind === 'pattern')).toBe(true);

    component.actionModel.set({
      name: 'with-dash',
      displayName: 'Test',
      description: ''
    });
    TestBed.tick();
    errors = component.actionForm.name().errors();
    expect(errors.some((e) => e.kind === 'pattern')).toBe(true);
  });

  it('validates name pattern — accepts valid names', () => {
    createComponent({});

    component.actionModel.set({
      name: 'read',
      displayName: 'Read',
      description: ''
    });
    TestBed.tick();
    let errors = component.actionForm.name().errors();
    expect(errors.some((e) => e.kind === 'pattern')).toBe(false);

    component.actionModel.set({
      name: 'read_all',
      displayName: 'Read All',
      description: ''
    });
    TestBed.tick();
    errors = component.actionForm.name().errors();
    expect(errors.some((e) => e.kind === 'pattern')).toBe(false);

    component.actionModel.set({
      name: 'r2d2',
      displayName: 'R2D2',
      description: ''
    });
    TestBed.tick();
    errors = component.actionForm.name().errors();
    expect(errors.some((e) => e.kind === 'pattern')).toBe(false);
  });

  it('disables Save button when form is pristine in create mode', () => {
    createComponent({});
    const saveBtn = fixture.nativeElement.querySelector(
      'button[matButton="filled"]'
    );
    expect(saveBtn?.disabled).toBe(true);
  });

  it('disables Save button when required name field is missing', () => {
    createComponent({});
    component.actionModel.set({
      name: '',
      displayName: 'Some Name',
      description: ''
    });
    TestBed.tick();
    fixture.detectChanges();
    const saveBtn = fixture.nativeElement.querySelector(
      'button[matButton="filled"]'
    );
    expect(saveBtn?.disabled).toBe(true);
  });

  it('disables Save button when required displayName field is missing', () => {
    createComponent({});
    component.actionModel.set({
      name: 'read',
      displayName: '',
      description: ''
    });
    TestBed.tick();
    fixture.detectChanges();
    const saveBtn = fixture.nativeElement.querySelector(
      'button[matButton="filled"]'
    );
    expect(saveBtn?.disabled).toBe(true);
  });

  it('calls store.createAction with trimmed values and closes dialog on submit in create mode', () => {
    createComponent({});
    component.actionModel.set({
      name: 'publish',
      displayName: '  Publish  ',
      description: '  Publish desc  '
    });
    TestBed.tick();

    component.submit();

    expect(resourcesStoreMock.createAction).toHaveBeenCalledWith({
      name: 'publish',
      displayName: 'Publish',
      description: 'Publish desc'
    });
    expect(dialogRefMock.close).toHaveBeenCalledWith(true);
  });

  it('calls store.updateAction with trimmed values and closes dialog on submit in edit mode', () => {
    createComponent({ action: mockAction });
    component.actionModel.set({
      name: 'read',
      displayName: '  Updated Read  ',
      description: 'Updated desc'
    });
    TestBed.tick();

    component.submit();

    expect(resourcesStoreMock.updateAction).toHaveBeenCalledWith('act-1', {
      displayName: 'Updated Read',
      description: 'Updated desc'
    });
    expect(dialogRefMock.close).toHaveBeenCalledWith(true);
  });

  it('calls dialogRef.close with no argument on cancel', () => {
    createComponent({});
    component.cancel();
    expect(dialogRefMock.close).toHaveBeenCalledWith();
  });

  it('does not call store when form is invalid on submit', () => {
    createComponent({});

    component.submit();

    expect(resourcesStoreMock.createAction).not.toHaveBeenCalled();
    expect(dialogRefMock.close).not.toHaveBeenCalled();
  });
});
