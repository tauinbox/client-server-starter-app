import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ConfirmDialogComponent } from './confirm-dialog.component';
import type { ConfirmDialogData } from './confirm-dialog.component';

const mockDialogData: ConfirmDialogData = {
  title: 'Confirm Delete',
  message: 'Are you sure you want to delete this item?',
  confirmButton: 'Delete',
  cancelButton: 'Cancel',
  icon: 'warning'
};

describe('ConfirmDialogComponent', () => {
  let component: ConfirmDialogComponent;
  let fixture: ComponentFixture<ConfirmDialogComponent>;
  let dialogRefMock: { close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    dialogRefMock = { close: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [ConfirmDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MAT_DIALOG_DATA, useValue: mockDialogData }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('data binding', () => {
    it('should expose injected dialog data', () => {
      expect(component.data.title).toBe('Confirm Delete');
      expect(component.data.message).toBe(
        'Are you sure you want to delete this item?'
      );
      expect(component.data.confirmButton).toBe('Delete');
      expect(component.data.cancelButton).toBe('Cancel');
      expect(component.data.icon).toBe('warning');
    });

    it('should work without optional icon field', async () => {
      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [ConfirmDialogComponent],
        providers: [
          provideNoopAnimations(),
          { provide: MatDialogRef, useValue: { close: vi.fn() } },
          {
            provide: MAT_DIALOG_DATA,
            useValue: {
              title: 'Title',
              message: 'Message',
              confirmButton: 'Yes',
              cancelButton: 'No'
            } satisfies ConfirmDialogData
          }
        ]
      }).compileComponents();

      const noIconFixture = TestBed.createComponent(ConfirmDialogComponent);
      noIconFixture.detectChanges();
      expect(noIconFixture.componentInstance.data.icon).toBeUndefined();
    });
  });

  describe('dialogRef injection', () => {
    it('should have access to the dialog ref', () => {
      expect(component.dialogRef).toBeDefined();
    });
  });
});
