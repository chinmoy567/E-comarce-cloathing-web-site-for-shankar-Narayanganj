import { hash, compare } from 'bcrypt';
import { NotFoundError, UnauthorizedError } from '../lib/errors.js';
import { withTransaction } from '../lib/transaction.js';
import * as customersRepository from '../repositories/customers.repository.js';
import * as usersRepository from '../repositories/users.repository.js';
import * as refreshTokensRepository from '../repositories/refreshTokens.repository.js';
import type { CustomerRecord } from '../types/customer.js';
import type {
  UpdateCustomerAddressInput,
  UpdateCustomerProfileInput,
} from '../validation/customer.validation.js';

/**
 * Customer business logic (02-customer §2.1–2.6).
 * Handles registration, login, password recovery, and profile management.
 *
 * Login credentials live on `users` (role=CUSTOMER), profile/address data
 * lives on `customers` — see migrations/0002_identity_address_audit.sql. A
 * CUSTOMER-role `users` row always requires a `customer_id` (`users_role_shape`
 * CHECK), so registration creates/reuses the `customers` row first.
 */

const BCRYPT_ROUNDS = 12;

/**
 * Register a new customer account (02-customer §2.1: phone + password only —
 * profile fields are completed later, per Section 2.2/2.6).
 *
 * Reuses an existing GUEST customer reference for this phone number (§2.9.8)
 * rather than creating a second record; the `users_phone_number_key` unique
 * constraint rejects a second login identity for an already-registered phone.
 */
export async function registerCustomer({
  phone_number,
  password,
}: {
  phone_number: string;
  password: string;
}): Promise<{ id: string; phone_number: string }> {
  const passwordHash = await hash(password, BCRYPT_ROUNDS);

  return withTransaction(async (client) => {
    const customer = await customersRepository.upsertByPhoneNumber(
      {
        fullName: '',
        phoneNumber: phone_number,
        email: null,
        address: {
          division: '',
          district: '',
          areaUnitType: 'UPAZILA',
          areaUnitName: '',
          wardUnitType: 'UNION',
          wardUnitName: '',
          detailedAddress: '',
          postalCode: null,
        },
      },
      'GUEST',
      client,
    );

    const promoted = await customersRepository.promoteToRegistered(customer.id, client);
    const registeredCustomer = promoted ?? customer;

    const user = await usersRepository.create(
      {
        role: 'CUSTOMER',
        passwordHash,
        phoneNumber: phone_number,
        customerId: registeredCustomer.id,
      },
      client,
    );

    return {
      id: user.id,
      phone_number: registeredCustomer.phoneNumber,
    };
  });
}

/**
 * Authenticate a customer with phone + password (02-customer §2.4).
 */
export async function loginCustomer({
  phone_number,
  password,
}: {
  phone_number: string;
  password: string;
}): Promise<{ id: string; phone_number: string }> {
  const user = await usersRepository.findByPhoneNumber(phone_number);

  if (!user || user.role !== 'CUSTOMER' || !user.isActive) {
    throw new UnauthorizedError('Invalid phone or password');
  }

  const isValid = await compare(password, user.passwordHash);
  if (!isValid) {
    throw new UnauthorizedError('Invalid phone or password');
  }

  return {
    id: user.id,
    phone_number: user.phoneNumber ?? phone_number,
  };
}

export type CustomerProfile = {
  id: string;
  phone_number: string;
  full_name: string;
  email?: string;
  division: string;
  district: string;
  area_unit_type: string;
  area_unit_name: string;
  ward_unit_type: string;
  ward_unit_name: string;
  detailed_address: string;
  postal_code: string | null;
  /** True when every §2.2 required field is present — the checkout gate. */
  is_complete: boolean;
};

function toProfile(userId: string, customer: CustomerRecord): CustomerProfile {
  const a = customer.address;
  return {
    id: userId,
    phone_number: customer.phoneNumber,
    full_name: customer.fullName,
    email: customer.email ?? undefined,
    division: a.division,
    district: a.district,
    area_unit_type: a.areaUnitType,
    area_unit_name: a.areaUnitName,
    ward_unit_type: a.wardUnitType,
    ward_unit_name: a.wardUnitName,
    detailed_address: a.detailedAddress,
    postal_code: a.postalCode,
    is_complete: [customer.fullName, a.division, a.district, a.areaUnitName, a.wardUnitName, a.detailedAddress].every(
      (v) => v.trim() !== '',
    ),
  };
}

/** Resolves the logged-in user to their `customers` row id; the id is never taken from the client. */
async function requireCustomerId(userId: string): Promise<string> {
  const user = await usersRepository.findById(userId);
  if (!user || user.role !== 'CUSTOMER' || !user.customerId) {
    throw new NotFoundError('Customer not found');
  }
  return user.customerId;
}

/**
 * Get customer profile by user ID.
 */
export async function getCustomerProfile(userId: string): Promise<CustomerProfile> {
  const customerId = await requireCustomerId(userId);
  const customer = await customersRepository.findById(customerId);
  if (!customer) {
    throw new NotFoundError('Customer not found');
  }
  return toProfile(userId, customer);
}

/**
 * Edit name and email (02-customer §2.6). The phone number is the login
 * identity; changing it needs the OTP verification flow that does not exist
 * yet, so it is deliberately not editable here.
 *
 * The email is mirrored onto `users` (password recovery reads it there) in
 * the same transaction, so the two rows never disagree.
 */
export async function updateCustomerProfile(
  userId: string,
  data: UpdateCustomerProfileInput,
): Promise<CustomerProfile> {
  const customerId = await requireCustomerId(userId);

  const updated = await withTransaction(async (client) => {
    const customer = await customersRepository.updateProfile(
      customerId,
      { fullName: data.full_name, email: data.email },
      client,
    );
    if (!customer) throw new NotFoundError('Customer not found');
    await usersRepository.update(userId, { email: data.email }, client);
    return customer;
  });

  return toProfile(userId, updated);
}

/** Replace the delivery address (02-customer §2.2/§2.6). */
export async function updateCustomerAddress(
  userId: string,
  data: UpdateCustomerAddressInput,
): Promise<CustomerProfile> {
  const customerId = await requireCustomerId(userId);

  const updated = await customersRepository.updateAddress(customerId, {
    division: data.division,
    district: data.district,
    areaUnitType: data.area_unit.type,
    areaUnitName: data.area_unit.name,
    wardUnitType: data.ward_unit.type,
    wardUnitName: data.ward_unit.name,
    detailedAddress: data.detailed_address,
    postalCode: data.postal_code,
  });
  if (!updated) throw new NotFoundError('Customer not found');

  return toProfile(userId, updated);
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
  userId: string,
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await usersRepository.findByIdWithSecret(userId);
  if (!user || user.role !== 'CUSTOMER') {
    throw new NotFoundError('Customer not found');
  }

  const isValid = await compare(oldPassword, user.passwordHash);
  if (!isValid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  const newHash = await hash(newPassword, BCRYPT_ROUNDS);
  await usersRepository.update(userId, { passwordHash: newHash });
  // Any other device holding a refresh token must sign in again with the new password.
  await refreshTokensRepository.revokeAllForUser(userId);
}
