import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

export type PasswordStrengthScore = 0 | 1 | 2 | 3 | 4;

const STRENGTH_LABEL_KEYS: Record<Exclude<PasswordStrengthScore, 0>, string> = {
  1: 'passwordStrength.weak',
  2: 'passwordStrength.fair',
  3: 'passwordStrength.good',
  4: 'passwordStrength.strong'
};

export function calculatePasswordStrength(
  password: string
): PasswordStrengthScore {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  return Math.max(score, 1) as PasswordStrengthScore;
}

@Component({
  selector: 'app-password-strength',
  imports: [TranslocoDirective],
  templateUrl: './password-strength.component.html',
  styleUrl: './password-strength.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PasswordStrengthComponent {
  readonly password = input.required<string>();

  readonly score = computed<PasswordStrengthScore>(() =>
    calculatePasswordStrength(this.password())
  );

  readonly labelKey = computed(() => {
    const score = this.score();
    return score === 0 ? '' : STRENGTH_LABEL_KEYS[score];
  });

  protected readonly bars: readonly (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];
}
