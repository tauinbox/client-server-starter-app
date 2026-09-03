import { STEP_UP_OPERATIONS } from '../constants/auth.constants';
import type { StepUpOperation } from '../constants/auth.constants';

/**
 * Narrows a value that arrived over the wire, or out of a token payload, to a
 * step-up operation the application knows. An unknown value is refused rather
 * than carried, so a proof can never name an operation nothing consumes.
 */
export function isStepUpOperation(value: unknown): value is StepUpOperation {
  return (
    typeof value === 'string' &&
    (STEP_UP_OPERATIONS as string[]).includes(value)
  );
}
