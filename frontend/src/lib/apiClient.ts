import type { ApiErrorBody, ApiErrorDetail, ApiListSuccess, ApiSuccess } from './apiTypes';

/**
 * The single typed HTTP client for the Express API (spec 01 §Frontend work).
 *
 * Every later page calls the backend through this wrapper so that backend
 * validation errors render consistently instead of each page inventing its own
 * error handling. The frontend is never the authority for prices, totals,
 * stock, permissions or order state — it only displays what the API returns.
 */

const DEFAULT_ERROR_MESSAGE = 'Something went wrong. Please try again.';

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: ApiErrorDetail[];
  readonly requestId: string | undefined;

  constructor(params: {
    code: string;
    message: string;
    status: number;
    details?: ApiErrorDetail[];
    requestId?: string;
  }) {
    super(params.message);
    this.name = 'ApiClientError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details ?? [];
    this.requestId = params.requestId;
  }

  /** Field-level message for rendering an error beside the matching input. */
  fieldError(field: string): string | undefined {
    return this.details.find((detail) => detail.field === field)?.message;
  }
}

function baseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!url) {
    throw new ApiClientError({
      code: 'CONFIG_ERROR',
      message: 'The API base URL is not configured.',
      status: 0,
    });
  }
  return url.replace(/\/$/, '');
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Next.js fetch cache hint; defaults to no-store for dynamic data. */
  cache?: RequestCache;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, headers = {}, cache = 'no-store' } = options;

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method,
      // Session cookies are sent for both transport choices left open in spec 03.
      credentials: 'include',
      cache,
      ...(signal ? { signal } : {}),
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    if (err instanceof ApiClientError) throw err;
    throw new ApiClientError({
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Check your connection and try again.',
      status: 0,
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const errorBody = payload as ApiErrorBody | undefined;
    throw new ApiClientError({
      code: errorBody?.error?.code ?? 'INTERNAL_ERROR',
      message: errorBody?.error?.message ?? DEFAULT_ERROR_MESSAGE,
      status: response.status,
      ...(errorBody?.error?.details ? { details: errorBody.error.details } : {}),
      ...(errorBody?.requestId ? { requestId: errorBody.requestId } : {}),
    });
  }

  return (payload as ApiSuccess<T>).data;
}

/** Unwraps `{ data }` and returns the payload. */
export function apiGet<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
  return request<T>(path, { ...options, method: 'GET' });
}

export function apiPost<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
  return request<T>(path, { ...options, method: 'POST', body });
}

export function apiPatch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
  return request<T>(path, { ...options, method: 'PATCH', body });
}

export function apiDelete<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> {
  return request<T>(path, { ...options, method: 'DELETE' });
}

/** Returns both the rows and the pagination block for a list endpoint. */
export async function apiList<T>(
  path: string,
  options?: Omit<RequestOptions, 'method' | 'body'>,
): Promise<ApiListSuccess<T>> {
  const { signal, headers = {}, cache = 'no-store' } = options ?? {};

  const response = await fetch(`${baseUrl()}${path}`, {
    method: 'GET',
    credentials: 'include',
    cache,
    ...(signal ? { signal } : {}),
    headers: { Accept: 'application/json', ...headers },
  });

  const payload = (await response.json()) as ApiListSuccess<T> | ApiErrorBody;

  if (!response.ok) {
    const errorBody = payload as ApiErrorBody;
    throw new ApiClientError({
      code: errorBody?.error?.code ?? 'INTERNAL_ERROR',
      message: errorBody?.error?.message ?? DEFAULT_ERROR_MESSAGE,
      status: response.status,
      ...(errorBody?.error?.details ? { details: errorBody.error.details } : {}),
      ...(errorBody?.requestId ? { requestId: errorBody.requestId } : {}),
    });
  }

  return payload as ApiListSuccess<T>;
}
