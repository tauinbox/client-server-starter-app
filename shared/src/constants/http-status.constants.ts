// The reason phrases of RFC 9110 15 (428 and 429: RFC 6585, 423: RFC 4918).
const HTTP_STATUS_TEXT: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  412: 'Precondition Failed',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  423: 'Locked',
  428: 'Precondition Required',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout'
};

/** The `error` field of the error envelope for a status code. */
export function httpStatusText(statusCode: number): string {
  return HTTP_STATUS_TEXT[statusCode] ?? 'Internal Server Error';
}
