const PG_UNIQUE_VIOLATION = '23505';

/**
 * True when the error is a PostgreSQL unique_violation.
 *
 * TypeORM copies the driver error's properties onto QueryFailedError, but the
 * pg driver's own errors arrive unwrapped, so both shapes are accepted.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, driverError } = error as {
    code?: string;
    driverError?: { code?: string };
  };
  return (code ?? driverError?.code) === PG_UNIQUE_VIOLATION;
}
