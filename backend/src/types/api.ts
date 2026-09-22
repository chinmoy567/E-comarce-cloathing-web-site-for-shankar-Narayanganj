/**
 * The shared API envelope (spec 01 §Shared API envelope).
 *
 * Every endpoint in every later spec uses these shapes. No endpoint invents
 * its own response shape.
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

export type ApiError = {
  error: {
    /** Stable machine-readable code, e.g. 'VALIDATION_ERROR'. */
    code: string;
    /** Safe, user-presentable text — never a stack trace or driver error. */
    message: string;
    /** Field errors only. */
    details?: ApiErrorDetail[];
  };
  requestId: string;
};
