import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output
} from '@angular/core';
import { MatButton, MatFabButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { LayoutService } from '@core/services/layout.service';

/**
 * The create action of a list page. It sits in the card header; on a handset
 * it becomes an extended FAB at the bottom right, so the action stays in reach
 * while the list scrolls.
 */
@Component({
  selector: 'nxs-create-button',
  imports: [MatButton, MatFabButton, MatIcon],
  templateUrl: './create-button.component.html',
  styleUrl: './create-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CreateButtonComponent {
  protected readonly layout = inject(LayoutService);

  /** The translated label, "New <entity>". */
  readonly label = input.required<string>();

  readonly pressed = output<void>();
}
