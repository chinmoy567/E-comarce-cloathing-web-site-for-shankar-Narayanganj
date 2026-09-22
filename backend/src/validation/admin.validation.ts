import { z } from 'zod';
import { paginationQuerySchema } from '../lib/pagination.js';
import { isPermissionKey, type PermissionKey } from '../types/permissions.js';
import { passwordSchema } from './password.validation.js';

/**
 * Back-office request schemas (spec 03 §Request/response types, §Validation
 * rules). `.strict()` throughout — an unknown field is rejected, never ignored
 * (11-security-hardening §11.6).
 *
 * No schema anywhere in this file accepts a `role` field (§5.15 rule 7): a
 * role is fixed at creation, the only creatable role is MANAGER, and there is
 * no "change role" action to guard.
 */

/** 3–64 chars, alphanumeric plus `._-`, trimmed. Compared case-insensitively by the service. */
const userIdentifierSchema = z
  .string()
  .trim()
  .min(3, 'Must be at least 3 characters.')
  .max(64, 'Must be at most 64 characters.')
  .regex(/^[a-zA-Z0-9._-]+$/, 'May only contain letters, numbers, dots, underscores, and hyphens.');

const permissionKeySchema = z.custom<PermissionKey>(isPermissionKey, {
  message: 'Not a recognized permission key.',
});

export const adminLoginSchema = z
  .object({
    userIdentifier: z.string().min(1, 'Required.'),
    password: z.string().min(1, 'Required.'),
  })
  .strict();
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Required.'),
    newPassword: passwordSchema,
  })
  .strict();
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const createManagerSchema = z
  .object({
    userIdentifier: userIdentifierSchema,
    password: passwordSchema,
    permissions: z.array(permissionKeySchema).optional(),
  })
  .strict();
export type CreateManagerInput = z.infer<typeof createManagerSchema>;

export const updateManagerSchema = z
  .object({
    userIdentifier: userIdentifierSchema.optional(),
    password: passwordSchema.optional(),
  })
  .strict();
export type UpdateManagerInput = z.infer<typeof updateManagerSchema>;

export const managerIdParamsSchema = z.object({ id: z.string().uuid('Must be a valid id.') }).strict();

export const setManagerPermissionsSchema = z
  .object({
    permissions: z.array(permissionKeySchema),
  })
  .strict();
export type SetManagerPermissionsInput = z.infer<typeof setManagerPermissionsSchema>;

export const listManagersQuerySchema = paginationQuerySchema;

export const auditLogsQuerySchema = paginationQuerySchema.extend({
  entityType: z.string().min(1).optional(),
});
export type AuditLogsQuery = z.infer<typeof auditLogsQuerySchema>;
