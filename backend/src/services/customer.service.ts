import { hashPassword, verifyPassword } from '../lib/password.js';
import { ConflictError, NotFoundError, UnauthorizedError } from '../lib/errors.js';
import { withTransaction } from '../lib/transaction.js';
import * as customersRepository from '../repositories/customers.repository.js';
import * as usersRepository from '../repositories/users.repository.js';
import { append as appendAudit } from '../repositories/audit.repository.js';
import * as refreshTokensRepository from '../repositories/refreshTokens.repository.js';
import * as customerAccountVerification from './customerAccountVerification.service.js';
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
  const passwordHash = await hashPassword(password);

  return withTransaction(async (client) => {
    // A phone that already has a customer record is never silently absorbed: a guest record carries
    // order history, so taking it over without proof of the phone is exactly the attack §2.9.8
    // forbids. A guest proves ownership through the claim flow instead.
    const existing = await customersRepository.findByPhoneNumber(phone_number, client);
    if (existing?.accountType === 'GUEST') {
      throw new ConflictError(
        'An order was placed with this phone number. Verify an order number to claim your account.',
        undefined,
        'GUEST_RECORD_EXISTS',
      );
    }
    if (existing) {
      throw new ConflictError('An account with this phone number already exists.', undefined, 'PHONE_ALREADY_REGISTERED');
    }

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

  const isValid = await verifyPassword(password, user.passwordHash);
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
  /** True once the email on the account was confirmed by link (the only address usable for recovery). */
  email_verified: boolean;
  /** An address waiting for confirmation (a link was emailed), if any. */
  pending_email?: string;
  /** True when every §2.2 required field is present — the checkout gate. */
  is_complete: boolean;
  /** Names of the required §2.2 fields still empty (empty when `is_complete`). */
  missing_fields: string[];
};

function toProfile(
  userId: string,
  customer: CustomerRecord,
  emailState: { verified: boolean; pending?: string } = { verified: false },
): CustomerProfile {
  const a = customer.address;
  const required: Array<[string, string]> = [
    ['full_name', customer.fullName],
    ['division', a.division],
    ['district', a.district],
    ['area_unit', a.areaUnitName],
    ['ward_unit', a.wardUnitName],
    ['detailed_address', a.detailedAddress],
  ];
  const missing_fields = required.filter(([, v]) => v.trim() === '').map(([k]) => k);
  return {
    id: userId,
    phone_number: customer.phoneNumber,
    full_name: customer.fullName,
    email: customer.email ?? undefined,
    email_verified: emailState.verified,
    ...(emailState.pending ? { pending_email: emailState.pending } : {}),
    division: a.division,
    district: a.district,
    area_unit_type: a.areaUnitType,
    area_unit_name: a.areaUnitName,
    ward_unit_type: a.wardUnitType,
    ward_unit_name: a.wardUnitName,
    detailed_address: a.detailedAddress,
    postal_code: a.postalCode,
    is_complete: missing_fields.length === 0,
    missing_fields,
  };
}

/** Builds the profile with the email-verification state read from the login row. */
async function profileFor(userId: string, customer: CustomerRecord): Promise<CustomerProfile> {
  const user = await usersRepository.findById(userId);
  const verified =
    !!user?.emailVerifiedAt && !!user.email && user.email.toLowerCase() === (customer.email ?? '').toLowerCase();
  return toProfile(userId, customer, {
    verified,
    ...(!verified && customer.email ? { pending: customer.email } : {}),
  });
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
  return profileFor(userId, customer);
}

/**
 * Edit name and email (02-customer §2.6). The phone number is the login
 * identity and is changed only through the verified phone-change flow
 * (`customerAccountVerification.service.ts`), never here.
 *
 * `customers.email` is saved at once as the contact address; `users.email` (the recovery
 * destination) changes only when the emailed confirmation link is used.
 */
export async function updateCustomerProfile(
  userId: string,
  data: UpdateCustomerProfileInput,
  requestId?: string | null,
): Promise<CustomerProfile> {
  const customerId = await requireCustomerId(userId);

  const updated = await withTransaction(async (client) => {
    const before = await customersRepository.findById(customerId, client);
    const customer = await customersRepository.updateProfile(
      customerId,
      { fullName: data.full_name, email: data.email },
      client,
    );
    if (!customer) throw new NotFoundError('Customer not found');

    // Audit only the fields that actually changed (database skill §4: no PII
    // beyond the changed field).
    const previous: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};
    if (before && before.fullName !== customer.fullName) {
      previous.full_name = before.fullName;
      next.full_name = customer.fullName;
    }
    if (before && (before.email ?? null) !== (customer.email ?? null)) {
      previous.email = before.email ?? null;
      next.email = customer.email ?? null;
    }
    if (Object.keys(next).length > 0) {
      await appendAudit(
        {
          entityType: 'customer',
          entityId: customerId,
          action: 'profile_updated',
          previousValue: previous,
          newValue: next,
          actorUserId: userId,
          actorType: 'USER',
          requestId,
        },
        client,
      );
    }
    return customer;
  });

  // The address on `users` is the password-recovery destination, so it is only ever written by a
  // confirmed link (spec 08 §Email change). Clearing the email removes the recovery channel at once.
  if (data.email === null) {
    await usersRepository.update(userId, { email: null, emailVerifiedAt: null });
  } else {
    await customerAccountVerification.requestEmailChange(userId, data.email);
  }

  return profileFor(userId, updated);
}

/** Replace the delivery address (02-customer §2.2/§2.6). */
export async function updateCustomerAddress(
  userId: string,
  data: UpdateCustomerAddressInput,
  requestId?: string | null,
): Promise<CustomerProfile> {
  const customerId = await requireCustomerId(userId);

  const updated = await withTransaction(async (client) => {
    const customer = await customersRepository.updateAddress(
      customerId,
      {
        division: data.division,
        district: data.district,
        areaUnitType: data.area_unit.type,
        areaUnitName: data.area_unit.name,
        wardUnitType: data.ward_unit.type,
        wardUnitName: data.ward_unit.name,
        detailedAddress: data.detailed_address,
        postalCode: data.postal_code,
      },
      client,
    );
    if (!customer) throw new NotFoundError('Customer not found');

    // The address itself is PII, so the trail records that it changed, not what it was.
    await appendAudit(
      {
        entityType: 'customer',
        entityId: customerId,
        action: 'address_updated',
        actorUserId: userId,
        actorType: 'USER',
        requestId,
      },
      client,
    );
    return customer;
  });

  return profileFor(userId, updated);
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

  const isValid = await verifyPassword(oldPassword, user.passwordHash);
  if (!isValid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  const newHash = await hashPassword(newPassword);
  await usersRepository.update(userId, { passwordHash: newHash });
  // Any other device holding a refresh token must sign in again with the new password.
  await refreshTokensRepository.revokeAllForUser(userId);
}
