import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';

@Component({
  selector: 'app-password-toggle',
  imports: [MatIcon, MatIconButton],
  template: `
    <button mat-icon-button type="button" (click)="toggle()">
      <mat-icon>{{ show() ? 'visibility_off' : 'visibility' }}</mat-icon>
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PasswordToggleComponent {
  readonly show = signal(false);

  toggle(): void {
    this.show.update((prev) => !prev);
  }
}
