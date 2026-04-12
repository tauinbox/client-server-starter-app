import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { of } from 'rxjs';
import { LayoutService } from '@core/services/layout.service';
import { AdaptiveDialogService } from './adaptive-dialog.service';
import type { ConfirmDialogData } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { ConfirmDialogComponent } from '@shared/components/confirm-dialog/confirm-dialog.component';
import { ConfirmBottomSheetComponent } from '@shared/components/confirm-dialog/confirm-bottom-sheet.component';

const mockData: ConfirmDialogData = {
  title: 'Delete?',
  message: 'Are you sure?',
  confirmButton: 'Yes',
  cancelButton: 'No'
};

describe('AdaptiveDialogService', () => {
  let service: AdaptiveDialogService;
  let dialogMock: { open: ReturnType<typeof vi.fn> };
  let bottomSheetMock: { open: ReturnType<typeof vi.fn> };
  let layoutMock: { isHandset: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    dialogMock = {
      open: vi.fn().mockReturnValue({ afterClosed: () => of(true) })
    };
    bottomSheetMock = {
      open: vi.fn().mockReturnValue({ afterDismissed: () => of(true) })
    };
    layoutMock = { isHandset: vi.fn().mockReturnValue(false) };

    TestBed.configureTestingModule({
      providers: [
        AdaptiveDialogService,
        { provide: MatDialog, useValue: dialogMock },
        { provide: MatBottomSheet, useValue: bottomSheetMock },
        { provide: LayoutService, useValue: layoutMock }
      ]
    });

    service = TestBed.inject(AdaptiveDialogService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should open dialog on non-handset viewport', () => {
    layoutMock.isHandset.mockReturnValue(false);

    service.openConfirm(mockData).subscribe();

    expect(dialogMock.open).toHaveBeenCalledWith(
      ConfirmDialogComponent,
      expect.objectContaining({ data: mockData })
    );
    expect(bottomSheetMock.open).not.toHaveBeenCalled();
  });

  it('should open bottom sheet on handset viewport', () => {
    layoutMock.isHandset.mockReturnValue(true);

    service.openConfirm(mockData).subscribe();

    expect(bottomSheetMock.open).toHaveBeenCalledWith(
      ConfirmBottomSheetComponent,
      { data: mockData }
    );
    expect(dialogMock.open).not.toHaveBeenCalled();
  });

  it('should emit confirmed value from dialog', () => {
    layoutMock.isHandset.mockReturnValue(false);
    dialogMock.open.mockReturnValue({ afterClosed: () => of(true) });

    let result: boolean | undefined;
    service.openConfirm(mockData).subscribe((v) => (result = v));

    expect(result).toBe(true);
  });

  it('should emit dismissed value from bottom sheet', () => {
    layoutMock.isHandset.mockReturnValue(true);
    bottomSheetMock.open.mockReturnValue({
      afterDismissed: () => of(false)
    });

    let result: boolean | undefined;
    service.openConfirm(mockData).subscribe((v) => (result = v));

    expect(result).toBe(false);
  });
});
