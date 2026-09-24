import type pg from 'pg';
import { randomUUID } from 'crypto';
import { hashPassword } from '../../src/lib/password';
import jwt from 'jsonwebtoken';
import { normalizePhone } from '../../src/lib/phone';

/**
 * Test factories for creating mock users, admins, and customers.
 */

export async function createMockUser(
  db: pg.PoolClient,
  email: string,
  role: 'ADMIN' | 'MANAGER' = 'ADMIN'
): Promise<{
  id: string;
  email: string;
  role: string;
  token: string;
}> {
  const userId = randomUUID();
  const password = 'Password@123';
  const passwordHash = await hashPassword(password);

  await db.query(
    `INSERT INTO users (id, email, password_hash, user_role, password_changed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())`,
    [userId, email, passwordHash, role]
  );

  // Generate JWT token for testing
  const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
  const token = jwt.sign(
    { sub: userId, email, role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  return {
    id: userId,
    email,
    role,
    token,
  };
}

export async function createMockAdmin(
  db: pg.PoolClient,
  email: string,
  role: 'ADMIN' | 'MANAGER' = 'ADMIN'
): Promise<{
  id: string;
  email: string;
  role: string;
  token: string;
}> {
  return createMockUser(db, email, role);
}

export async function createMockCustomer(
  db: pg.PoolClient,
  phone: string,
  name?: string
): Promise<{
  id: string;
  phone: string;
  name: string;
}> {
  const customerId = randomUUID();
  const normalizedPhone = normalizePhone(phone);
  const customerName = name || 'Test Customer';

  await db.query(
    `INSERT INTO customers (id, phone, name, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())`,
    [customerId, normalizedPhone, customerName]
  );

  return {
    id: customerId,
    phone: normalizedPhone,
    name: customerName,
  };
}

export async function createMockProduct(
  db: pg.PoolClient,
  categoryId: string,
  name?: string,
  sku?: string
): Promise<{
  id: string;
  category_id: string;
  name: string;
  sku: string;
}> {
  const productId = randomUUID();
  const productName = name || `Test Product ${Date.now()}`;
  const productSku = sku || `SKU-${Date.now()}`;

  await db.query(
    `INSERT INTO products (id, category_id, name, sku, product_status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())`,
    [productId, categoryId, productName, productSku]
  );

  return {
    id: productId,
    category_id: categoryId,
    name: productName,
    sku: productSku,
  };
}
