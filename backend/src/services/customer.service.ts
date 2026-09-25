import { hash, compare } from 'bcrypt';
import { ConflictError, NotFoundError, UnauthorizedError, BadRequestError } from '../lib/errors.js';
import * as customersRepository from '../repositories/customers.repository.js';
import type { CustomerProfileInput } from '../validation/customer.validation.js';

/**
 * Customer business logic (02-customer §2.1–2.6).
 * Handles registration, login, password recovery, and profile management.
 */

const BCRYPT_ROUNDS = 12;

/**
 * Register a new customer account.
 * Phone must be unique; password is hashed.
 */
export async function registerCustomer({
  phone_number,
  password,
}: {
  phone_number: string;
  password: string;
}): Promise<{ id: string; phone_number: string }> {
  // Check if customer already exists
  const existing = await customersRepository.findByPhone(phone_number);
  if (existing && existing.account_type === 'REGISTERED') {
    throw new ConflictError('Phone number already registered');
  }

  // Hash password
  const passwordHash = await hash(password, BCRYPT_ROUNDS);

  // Create customer record as REGISTERED
  const customer = await customersRepository.createCustomer({
    phone_number,
    password_hash: passwordHash,
    account_type: 'REGISTERED',
    full_name: '', // Will be filled in during profile completion
    division: '', // Placeholder; validated during checkout/profile update
    district: '',
    area_unit_type: 'UPAZILA',
    area_unit_name: '',
    ward_unit_type: 'UNION',
    ward_unit_name: '',
    detailed_address: '',
  });

  return {
    id: customer.id,
    phone_number: customer.phone_number,
  };
}

/**
 * Authenticate a customer with phone + password.
 */
export async function loginCustomer({
  phone_number,
  password,
}: {
  phone_number: string;
  password: string;
}): Promise<{ id: string; phone_number: string }> {
  const customer = await customersRepository.findByPhone(phone_number);

  if (!customer || customer.account_type !== 'REGISTERED' || !customer.password_hash) {
    throw new UnauthorizedError('Invalid phone or password');
  }

  const isValid = await compare(password, customer.password_hash);
  if (!isValid) {
    throw new UnauthorizedError('Invalid phone or password');
  }

  return {
    id: customer.id,
    phone_number: customer.phone_number,
  };
}

/**
 * Get customer profile by ID.
 */
export async function getCustomerProfile(customerId: string): Promise<{
  id: string;
  phone_number: string;
  full_name: string;
  email?: string;
  division: string;
  district: string;
}> {
  const customer = await customersRepository.findById(customerId);
  if (!customer) {
    throw new NotFoundError('Customer not found');
  }

  return {
    id: customer.id,
    phone_number: customer.phone_number,
    full_name: customer.full_name,
    email: customer.email || undefined,
    division: customer.division,
    district: customer.district,
  };
}

/**
 * Update customer profile (phone completeness validation).
 */
export async function updateCustomerProfile(
  customerId: string,
  data: Partial<CustomerProfileInput>,
): Promise<void> {
  const customer = await customersRepository.findById(customerId);
  if (!customer) {
    throw new NotFoundError('Customer not found');
  }

  // TODO: Check if phone is being changed and already exists
  // TODO: Implement the update

  return;
}

/**
 * Request password reset OTP.
 * TODO: Generate OTP, store in database, send via email.
 */
export async function requestPasswordResetOtp(email: string): Promise<{ otp_id: string }> {
  // TODO: Find customer by email
  // TODO: Generate OTP (6 digits)
  // TODO: Store OTP with expiry (10 min) and rate-limit metadata
  // TODO: Send OTP via email service
  // Return otp_id for verification step

  return { otp_id: 'todo' };
}

/**
 * Verify password reset OTP.
 * TODO: Check OTP validity, expiry, attempt count.
 */
export async function verifyPasswordResetOtp(otpId: string, otpCode: string): Promise<string> {
  // TODO: Look up OTP record
  // TODO: Validate code, expiry, attempt count
  // TODO: Increment attempt counter
  // TODO: If valid, mark as used and generate reset token
  // TODO: Return reset token (JWT with short expiry)

  return 'reset_token_todo';
}

/**
 * Reset customer password with valid reset token.
 * TODO: Verify reset token, extract customer ID, hash new password.
 */
export async function resetPassword(resetToken: string, newPassword: string): Promise<void> {
  // TODO: Verify reset token (JWT)
  // TODO: Extract customer ID from token
  // TODO: Hash new password
  // TODO: Update customer record
  // TODO: Invalidate all refresh tokens for this customer (force re-login elsewhere)
}

/**
 * Change customer password (authenticated, requires old password).
 */
export async function changeCustomerPassword(
  customerId: string,
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  const customer = await customersRepository.findById(customerId);
  if (!customer || !customer.password_hash) {
    throw new NotFoundError('Customer not found');
  }

  // Verify old password
  const isValid = await compare(oldPassword, customer.password_hash);
  if (!isValid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  // Hash and update new password
  const newHash = await hash(newPassword, BCRYPT_ROUNDS);
  // TODO: Update customer record
}
