/**
 * Envelope for a 400 that mirrors a class-validator rejection on the real
 * server. `GlobalExceptionFilter` turns the ValidationPipe's string[] into a
 * joined `message` plus the original array in `errors`, and the client keys off
 * `errors` to show a translated generic message instead of raw validator text.
 * A 400 the server raises from service logic carries no `errors` key and must
 * keep sending a bare `{ message, statusCode }` here.
 */
export function validationError(message: string): {
  message: string;
  errors: string[];
  statusCode: number;
  error: string;
} {
  return {
    message,
    errors: [message],
    statusCode: 400,
    error: 'Bad Request'
  };
}
