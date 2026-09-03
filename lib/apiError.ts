// Public API error helpers. THE LOCAL uses the flat response while shipped
// Heritage consumers keep the legacy nested response below.

const NO_STORE = "no-store";

export type PublicApiError = {
  /** Back-compatible human-readable message for existing clients. */
  error: string;
  code: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type PublicApiErrorOptions = {
  retryable?: boolean;
  details?: Record<string, unknown>;
  /** Additive legacy siblings only; canonical error fields always win. */
  compatibilityFields?: Record<string, unknown>;
  headers?: HeadersInit;
};

/**
 * Flat public error response used by THE LOCAL routes.
 *
 * Keep this separate from the legacy nested `apiError()` response below:
 * Heritage still has a shipped consumer for that envelope, while THE LOCAL's
 * public contract is the additive flat `{ error, code, retryable, details? }`
 * shape.
 */
export function publicApiError(
  error: string,
  code: string,
  status: number,
  options: PublicApiErrorOptions = {},
): Response {
  const headers = new Headers(options.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", NO_STORE);
  const body: PublicApiError & Record<string, unknown> = {
    ...(options.compatibilityFields ?? {}),
    error,
    code,
    retryable: options.retryable ?? false,
    ...(options.details ? { details: options.details } : {}),
  };
  return Response.json(body, { status, headers });
}

/** Conventional generic code for a bare HTTP status. */
export function statusErrorCode(status: number): string {
  switch (status) {
    case 400:
      return "INVALID_REQUEST";
    case 401:
      return "UNAUTHENTICATED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 405:
      return "METHOD_NOT_ALLOWED";
    case 409:
      return "CONFLICT";
    case 410:
      return "GONE";
    case 413:
      return "PAYLOAD_TOO_LARGE";
    case 422:
      return "UNPROCESSABLE";
    case 429:
      return "RATE_LIMITED";
    case 500:
      return "INTERNAL_ERROR";
    case 502:
      return "PROVIDER_UNAVAILABLE";
    case 503:
      return "UNAVAILABLE";
    default:
      return "ERROR";
  }
}

/**
 * Flat public error for call sites that carry only a message and a status
 * (shared gates that decide the status upstream). The code falls back to the
 * conventional generic for that status; 429 and 5xx read as retryable.
 */
export function publicApiErrorFromStatus(
  error: string,
  status: number,
  options: PublicApiErrorOptions = {},
): Response {
  return publicApiError(error, statusErrorCode(status), status, {
    retryable: status === 429 || status >= 500,
    ...options,
  });
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    status: number;
  };
}

export function apiError(
  code: string,
  message: string,
  status: number,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", NO_STORE);
  }
  const body: ApiErrorBody = { error: { code, message, status } };
  return Response.json(body, { ...init, status, headers });
}
