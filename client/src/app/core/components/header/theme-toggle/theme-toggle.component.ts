import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Signal
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { ThemeMode, ThemeService } from '@core/services/theme.service';

@Component({
  selector: 'app-theme-toggle',
  imports: [MatIconButton, MatTooltip, MatIcon],
  templateUrl: './theme-toggle.component.html',
  styleUrl: './theme-toggle.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ThemeToggleComponent {
  readonly #themeService = inject(ThemeService);

  protected readonly toggleTheme = this.#themeService.toggleTheme.bind(this.#themeService);
  protected readonly theme: Signal<ThemeMode> = this.#themeService.theme;
}
