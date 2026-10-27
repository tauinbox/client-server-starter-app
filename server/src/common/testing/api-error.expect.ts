import { ERROR_STATUS, type ErrorKey } from '@app/shared/constants';
import { ApiError } from '../errors/api-error';

/** The error is an `ApiError` with this key and the status of the key. */
export function expectApiError(error: unknown, errorKey: ErrorKey): void {
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).errorKey).toBe(errorKey);
  expect((error as ApiError).getStatus()).toBe(ERROR_STATUS[errorKey]);
}

/** The promise rejects with an `ApiError` of this key and its status. */
export async function expectApiRejection(
  action: Promise<unknown>,
  errorKey: ErrorKey
): Promise<void> {
  const error: unknown = await action.then(
    () => {
      throw new Error('Expected the promise to reject');
    },
    (caught: unknown) => caught
  );
  expectApiError(error, errorKey);
}
