import type { OnDestroy, OnInit } from '@angular/core';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatDialog } from '@angular/material/dialog';
import { HeaderComponent } from '@core/components/header/header.component';
import { SidenavComponent } from '@core/components/sidenav/sidenav.component';
import { AuthStore } from '@features/auth/store/auth.store';
import { SidenavStateService } from '@core/services/sidenav-state.service';
import { KeyboardShortcutsService } from '@core/services/keyboard-shortcuts.service';
import { KeyboardShortcutsHelpComponent } from '@shared/components/keyboard-shortcuts-help/keyboard-shortcuts-help.component';
import { DialogSize, dialogSizeConfig } from '@shared/utils/dialog.utils';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, HeaderComponent, SidenavComponent, MatSidenavModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent implements OnInit, OnDestroy {
  protected readonly authStore = inject(AuthStore);
  protected readonly sidenavState = inject(SidenavStateService);
  readonly #shortcuts = inject(KeyboardShortcutsService);
  readonly #dialog = inject(MatDialog);

  #cleanupQuestion: (() => void) | null = null;
  #cleanupCtrlSlash: (() => void) | null = null;

  ngOnInit(): void {
    const openHelp = () => this.#openHelp();
    this.#cleanupQuestion = this.#shortcuts.register(
      '?',
      'shortcuts.labelHelp',
      'shortcuts.groupGlobal',
      openHelp
    );
    this.#cleanupCtrlSlash = this.#shortcuts.register(
      'ctrl+/',
      'shortcuts.labelHelp',
      'shortcuts.groupGlobal',
      openHelp
    );
  }

  ngOnDestroy(): void {
    this.#cleanupQuestion?.();
    this.#cleanupCtrlSlash?.();
  }

  #openHelp(): void {
    const alreadyOpen = this.#dialog.openDialogs.some(
      (ref) => ref.componentInstance instanceof KeyboardShortcutsHelpComponent
    );
    if (alreadyOpen) return;
    this.#dialog.open(
      KeyboardShortcutsHelpComponent,
      dialogSizeConfig(DialogSize.Form)
    );
  }
}
