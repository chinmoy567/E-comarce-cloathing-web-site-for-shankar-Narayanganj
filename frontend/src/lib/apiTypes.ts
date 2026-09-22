/**
 * Mirrors the backend envelope in `backend/src/types/api.ts`.
 *
 * Kept as a hand-maintained copy rather than a cross-workspace import so the
 * frontend build never reaches into backend source (which holds the
 * service-role client).
 */
export type ApiSuccess<T> = { data: T };

export type PaginationBlock = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type ApiListSuccess<T> = {
  data: T[];
  pagination: PaginationBlock;
};

export type ApiErrorDetail = { field: string; message: string };

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
  };
  requestId: string;
};
