import { jest } from '@jest/globals';
import { scenarioClock } from '@app/shared/utils/request-scenarios';

/** The clock of the `revoked-actor` fixture in the server e2e suites. */
export const SCENARIO_CLOCK = scenarioClock(jest);
