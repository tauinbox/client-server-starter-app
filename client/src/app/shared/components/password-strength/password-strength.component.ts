import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { MIN_PASSWORD_LENGTH } from '@app/shared/constants';

export type PasswordStrengthScore = 0 | 1 | 2 | 3 | 4;

const STRENGTH_LABEL_KEYS: Record<Exclude<PasswordStrengthScore, 0>, string> = {
  1: 'passwordStrength.weak',
  2: 'passwordStrength.fair',
  3: 'passwordStrength.good',
  4: 'passwordStrength.strong'
};

const CHARACTER_CLASSES = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/];

/**
 * Length alone can reach the top of the scale and character variety only
 * shortens the way there. The composition rules were removed because they do
 * not improve the passwords people choose, so a meter that needed a digit for
 * its last bar would keep advertising a rule that no longer exists.
 */
export function calculatePasswordStrength(
  password: string
): PasswordStrengthScore {
  if (!password) return 0;
  let score = 0;
  for (const threshold of [MIN_PASSWORD_LENGTH, 12, 16, 20]) {
    if (password.length >= threshold) score++;
  }
  if (CHARACTER_CLASSES.filter((rule) => rule.test(password)).length >= 3) {
    score++;
  }
  return Math.min(Math.max(score, 1), 4) as PasswordStrengthScore;
}

@Component({
  selector: 'nxs-password-strength',
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

  /**
   * Names what raises the score while the value still scores low, so the user
   * reads the advice instead of only seeing a short bar.
   */
  readonly showRequirements = computed(() => {
    return this.password().length > 0 && this.score() < 3;
  });

  protected readonly bars: readonly (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];
}
