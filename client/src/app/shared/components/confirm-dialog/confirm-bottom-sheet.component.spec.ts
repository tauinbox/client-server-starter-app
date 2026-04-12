import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import {
  MAT_BOTTOM_SHEET_DATA,
  MatBottomSheetRef
} from '@angular/material/bottom-sheet';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslocoTestingModuleWithLangs } from '../../../../test-utils/transloco-testing';

import { ConfirmBottomSheetComponent } from './confirm-bottom-sheet.component';
import type { ConfirmDialogData } from './confirm-dialog.component';

const mockData: ConfirmDialogData = {
  title: 'Confirm Delete',
  message: 'Are you sure you want to delete this item?',
  confirmButton: 'Delete',
  cancelButton: 'Cancel',
  icon: 'warning'
};

describe('ConfirmBottomSheetComponent', () => {
  let component: ConfirmBottomSheetComponent;
  let fixture: ComponentFixture<ConfirmBottomSheetComponent>;
  let bottomSheetRefMock: { dismiss: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    bottomSheetRefMock = { dismiss: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [ConfirmBottomSheetComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        { provide: MatBottomSheetRef, useValue: bottomSheetRefMock },
        { provide: MAT_BOTTOM_SHEET_DATA, useValue: mockData }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmBottomSheetComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should expose injected data', () => {
    expect(component.data.title).toBe('Confirm Delete');
    expect(component.data.message).toBe(
      'Are you sure you want to delete this item?'
    );
    expect(component.data.confirmButton).toBe('Delete');
    expect(component.data.cancelButton).toBe('Cancel');
    expect(component.data.icon).toBe('warning');
  });

  it('should dismiss with false on cancel', () => {
    component.cancel();
    expect(bottomSheetRefMock.dismiss).toHaveBeenCalledWith(false);
  });

  it('should dismiss with true on confirm', () => {
    component.confirm();
    expect(bottomSheetRefMock.dismiss).toHaveBeenCalledWith(true);
  });
});
