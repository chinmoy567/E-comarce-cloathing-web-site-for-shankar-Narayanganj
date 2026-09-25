import { z } from 'zod';

/**
 * Customer authentication & profile validation (02-customer §2.1–2.6).
 * Reuses the Bangladesh phone format from the database constraint.
 */

// Bangladesh mobile phone: 01[3-9]XXXXXXXX (11 digits total)
const bdPhoneSchema = z
  .string()
  .regex(/^01[3-9]\d{8}$/, 'Invalid Bangladesh phone number')
  .describe('Bangladesh mobile phone number in format 01XXXXXXXXX');

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .describe('Password must be at least 8 characters');

// Register: phone + password only (02-customer §2.1)
export const customerRegisterSchema = z.object({
  phone_number: bdPhoneSchema,
  password: passwordSchema,
});
export type CustomerRegisterInput = z.infer<typeof customerRegisterSchema>;

// Login: phone + password (02-customer §2.4)
export const customerLoginSchema = z.object({
  phone_number: bdPhoneSchema,
  password: passwordSchema,
});
export type CustomerLoginInput = z.infer<typeof customerLoginSchema>;

// Forgot password: email only (02-customer §2.5)
export const customerRequestOtpSchema = z.object({
  email: z.string().email('Invalid email address'),
});
export type CustomerRequestOtpInput = z.infer<typeof customerRequestOtpSchema>;

// Verify OTP: otp_id + otp_code
export const customerVerifyOtpSchema = z.object({
  otp_id: z.string().uuid('Invalid OTP ID'),
  otp_code: z.string().length(6, 'OTP must be 6 digits').regex(/^\d{6}$/, 'OTP must be numeric'),
});
export type CustomerVerifyOtpInput = z.infer<typeof customerVerifyOtpSchema>;

// Reset password: reset_token + new_password
export const customerResetPasswordSchema = z.object({
  reset_token: z.string().min(1, 'Reset token required'),
  new_password: passwordSchema,
});
export type CustomerResetPasswordInput = z.infer<typeof customerResetPasswordSchema>;

// Change password: old_password + new_password (authenticated)
export const changeCustomerPasswordSchema = z.object({
  old_password: z.string(),
  new_password: passwordSchema,
});
export type ChangeCustomerPasswordInput = z.infer<typeof changeCustomerPasswordSchema>;

// ============================================================================
// Profile & Address
// ============================================================================

// Bangladesh geography: discriminated union for Upazila/Thana and Union/Ward
const areaUnitSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('UPAZILA'),
    name: z.string().min(1, 'Upazila name required'),
  }),
  z.object({
    type: z.literal('THANA'),
    name: z.string().min(1, 'Thana name required'),
  }),
]);

const wardUnitSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('UNION'),
    name: z.string().min(1, 'Union name required'),
  }),
  z.object({
    type: z.literal('WARD'),
    name: z.string().min(1, 'Ward name required'),
  }),
]);

// Profile completion: everything except email (email optional per §2.2)
export const customerProfileSchema = z.object({
  full_name: z.string().min(1, 'Full name required'),
  email: z.string().email('Invalid email').nullable().optional(),
  phone_number: bdPhoneSchema,
  division: z.string().min(1, 'Division required'),
  district: z.string().min(1, 'District required'),
  area_unit: areaUnitSchema,
  ward_unit: wardUnitSchema,
  detailed_address: z.string().min(1, 'Detailed address required'),
  postal_code: z.string().optional().nullable(),
});
export type CustomerProfileInput = z.infer<typeof customerProfileSchema>;

// Guest checkout fields (02-customer §2.9.2): same as profile but explicit per-field
export const guestCheckoutSchema = z.object({
  full_name: z.string().min(1, 'Full name required'),
  phone_number: bdPhoneSchema,
  email: z.string().email('Invalid email').optional().nullable(),
  division: z.string().min(1, 'Division required'),
  district: z.string().min(1, 'District required'),
  area_unit: areaUnitSchema,
  ward_unit: wardUnitSchema,
  detailed_address: z.string().min(1, 'Detailed address required'),
  postal_code: z.string().optional().nullable(),
});
export type GuestCheckoutInput = z.infer<typeof guestCheckoutSchema>;

// Address management: create/update address
export const addressSchema = z.object({
  full_name: z.string().min(1, 'Full name required'),
  phone_number: bdPhoneSchema,
  division: z.string().min(1, 'Division required'),
  district: z.string().min(1, 'District required'),
  area_unit: areaUnitSchema,
  ward_unit: wardUnitSchema,
  detailed_address: z.string().min(1, 'Detailed address required'),
  postal_code: z.string().optional().nullable(),
  is_default: z.boolean().optional().default(false),
});
export type AddressInput = z.infer<typeof addressSchema>;
