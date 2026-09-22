/** Global JSON body size limit (11-security-hardening §11.4). */
export const JSON_BODY_LIMIT = '100kb';

/** Header carrying the per-request correlation id. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Pagination bounds, mandatory on every list endpoint (§11.4). */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** The only message an unexpected server error may present to a client. */
export const GENERIC_ERROR_MESSAGE = 'An unexpected error occurred.';
